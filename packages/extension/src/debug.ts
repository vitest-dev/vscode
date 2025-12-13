import type { VitestPackage } from './api/pkg'
import type { ExtensionWorkerProcess } from './api/types'
import type { WsConnectionMetadata } from './api/ws'
import type { ExtensionDiagnostic } from './diagnostic'
import type { ImportsBreakdownProvider } from './importsBreakdownProvider'
import type { TestTree } from './testTree'
import crypto from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import getPort from 'get-port'
import * as vscode from 'vscode'
import { WebSocketServer } from 'ws'
import { VitestFolderAPI } from './api'
import { onWsConnection } from './api/ws'
import { getConfig } from './config'
import { workerPath } from './constants'
import { log } from './log'
import { TestRunner } from './runner'
import { getTestData, TestCase, TestFile, TestFolder, TestSuite } from './testTreeData'
import { findNode } from './utils'

const DebugSessionName = 'Vitest'
const BrowserDebugSessionName = 'Vitest_Browser'

export async function debugTests(
  controller: vscode.TestController,
  tree: TestTree,
  pkg: VitestPackage,
  diagnostic: ExtensionDiagnostic | undefined,
  importsBreakdown: ImportsBreakdownProvider,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  debugManager: DebugManager,
) {
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`

  const config = getConfig(pkg.folder)
  const deferredPromise = Promise.withResolvers<void>()

  const { runtimeArgs, runtimeExecutable } = await getRuntimeOptions(pkg)
  const env = config.env || {}
  const debugEnv = config.debugEnv || {}
  const logLevel = config.logLevel

  log.info('[DEBUG]', 'Starting debugging session', runtimeExecutable, ...(runtimeArgs || []))

  const debugId = crypto.randomUUID()
  const browserDebug = getBrowserDebugInfo(controller, request)

  const skipFiles = [
    ...(config.debugExclude || []),
    '**/node_modules/@vitest/{runner,utils}/**',
    '**/node_modules/vitest/dist/**',
  ]

  const debugConfig = {
    __name: DebugSessionName,
    __vitestId: debugId,
    type: config.shellType === 'terminal' ? 'node-terminal' : 'pwa-node',
    request: 'launch',
    name: 'Debug Tests',
    autoAttachChildProcesses: true,
    skipFiles,
    ...(
      config.debugOutFiles?.length
        ? { outFiles: config.debugOutFiles }
        : {}
    ),
    smartStep: true,
    ...(config.shellType === 'terminal'
      ? {
          command: `${runtimeExecutable} ${workerPath};exit`,
        }
      : {
          program: workerPath,
          runtimeArgs,
          runtimeExecutable,
        }
    ),
    cwd: pkg.cwd,
    env: {
      ...process.env,
      ...env,
      ...debugEnv,
      VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? logLevel,
      VITEST_VSCODE: 'true',
      VITEST_WS_ADDRESS: wsAddress,
      // same env var as `startVitest`
      // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
    },
  }

  if (debugManager.sessions.size) {
    await Promise.all(
      [...debugManager.sessions].map(session => vscode.debug.stopDebugging(session)),
    ).catch((error) => {
      log.error('[DEBUG] Failed to stop debugging sessions', error)
    })
  }

  vscode.debug.startDebugging(
    pkg.folder,
    debugConfig,
    { suppressDebugView: true },
  ).then(
    (fulfilled) => {
      if (fulfilled) {
        log.info('[DEBUG] Debugging started')
      }
      else {
        deferredPromise.reject(new Error('Failed to start debugging. See output for more information.'))
        log.error('[DEBUG] Debugging failed')
      }
    },
    (err) => {
      deferredPromise.reject(new Error('Failed to start debugging', { cause: err }))
      log.error('[DEBUG] Start debugging failed')
      log.error(err.toString())
    },
  )

  const disposables: vscode.Disposable[] = []

  wss.on(
    'connection',
    ws => onWsConnection(
      ws,
      pkg,
      browserDebug
        ? {
            browser: browserDebug.browser,
            // wdio support this only since Vitest beta-13
            port: config.debuggerPort ?? 9229,
            host: 'localhost',
          }
        : true,
      config.shellType,
      false,
      async (metadata) => {
        try {
          const api = new VitestFolderAPI(pkg, {
            ...metadata,
            process: new ExtensionDebugProcess(
              metadata,
            ),
          })
          const runner = new TestRunner(
            controller,
            tree,
            api,
            diagnostic,
            importsBreakdown,
          )
          disposables.push(api, runner)

          token.onCancellationRequested(async () => {
            await metadata.rpc.close()
          })

          if (browserDebug) {
            const browserAttachConfig = {
              __name: BrowserDebugSessionName,
              __parentId: debugId,
              request: 'attach',
              name: `Debug Tests (${browserDebug.browser})`,
              address: 'localhost',
              port: config.debuggerPort ?? 9229,
              ...(
                config.debugOutFiles?.length
                  ? { outFiles: config.debugOutFiles }
                  : {}
              ),
              smartStep: true,
              skipFiles,
              cwd: pkg.cwd,
              type: browserDebug.browser === 'edge' ? 'msedge' : 'chrome',
            }
            let parentSession: vscode.DebugSession | undefined
            for (const session of debugManager.sessions.values()) {
              if (session.configuration.__vitestId === debugId) {
                parentSession = session
              }
            }
            vscode.debug.startDebugging(
              pkg.folder,
              browserAttachConfig,
              {
                parentSession,
                // this is required for the "restart" button to work
                // TODO: but it still doesn't work
                lifecycleManagedByParent: true,
                compact: true,
              },
            ).then(
              (fullfilled) => {
                metadata.rpc.onBrowserDebug(fullfilled).catch(() => {})
                if (fullfilled) {
                  log.info('[DEBUG] Secondary debug launch config started')
                }
                else {
                  log.error('[DEBUG] Secondary debug launch config failed')
                }
              },
              (error) => {
                metadata.rpc.onBrowserDebug(false).catch(() => {})
                log.error('[DEBUG] Browser debugger failed to launch', error.message)
              },
            )
          }

          await runner.runTests(request, token)

          deferredPromise.resolve()
        }
        catch (err: any) {
          if (err.message.startsWith('[birpc] rpc is closed')) {
            deferredPromise.resolve()
            return
          }

          deferredPromise.reject(err)
        }
      },
      (err) => {
        if (err.message.startsWith('[birpc] rpc is closed')) {
          deferredPromise.resolve()
          return
        }

        deferredPromise.reject(err)
      },
    ),
  )

  const onDidWorkerTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    const parent = session.parentSession

    // dispose all test runners
    if (
      session.configuration.__name !== BrowserDebugSessionName
      && parent
      && parent.configuration.__name === DebugSessionName
    ) {
      disposables.reverse().forEach(d => d.dispose())
      disposables.length = 0
    }
  })

  const onDidTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.configuration.__name !== DebugSessionName)
      return
    server.close()
    onDidTerminate.dispose()
    onDidWorkerTerminate.dispose()
  })

  await deferredPromise.promise
}

async function getRuntimeOptions(pkg: VitestPackage) {
  const config = getConfig(pkg.folder)

  const runtimeArgs = config.nodeExecArgs || []
  const pnpLoader = pkg.loader
  const pnp = pkg.pnp
  const execArgv = pnpLoader && pnp
    ? [
        '--require',
        pnp,
        '--experimental-loader',
        pathToFileURL(pnpLoader).toString(),
        ...runtimeArgs,
      ]
    : runtimeArgs
  if (config.shellType === 'child_process') {
    const executable = await findNode(pkg.cwd)
    return {
      runtimeExecutable: executable,
      runtimeArgs: execArgv,
    }
  }
  return {
    runtimeExecutable: 'node',
    runtimeArgs: execArgv,
  }
}

class ExtensionDebugProcess implements ExtensionWorkerProcess {
  public id: number = Math.random()
  public closed = false

  private _onDidExit = new vscode.EventEmitter<void>()

  constructor(private metadata: WsConnectionMetadata) {
    // if websocket connection stopped working, close the debug session
    // otherwise it might hang indefinitely
    metadata.ws.on('close', () => {
      this.closed = true
      this._onDidExit.fire()
      this._onDidExit.dispose()
    })
  }

  async close() {
    if (this.metadata.rpc.$closed) {
      return
    }
    await this.metadata.rpc.close()
  }

  onError() {
    // do nothing
    return () => {}
  }

  onExit(listener: (code: number | null) => void) {
    const { dispose } = this._onDidExit.event(() => {
      listener(null)
    })
    return dispose
  }
}

export class DebugManager {
  public sessions: Set<vscode.DebugSession> = new Set()

  constructor() {
    vscode.debug.onDidStartDebugSession((session) => {
      if (session.configuration.__name === DebugSessionName) {
        this.sessions.add(session)
      }
    })

    vscode.debug.onDidTerminateDebugSession((session) => {
      this.sessions.delete(session)
    })
  }
}

function getBrowserDebugInfo(controller: vscode.TestController, request: vscode.TestRunRequest) {
  let provider: string | undefined
  let browser: string | undefined

  function traverse(testItem: vscode.TestItem) {
    const data = getTestData(testItem)

    if (data instanceof TestFile) {
      if (request.exclude?.includes(testItem)) {
        return
      }

      const options = data.metadata.browser
      if (!options) {
        return
      }
      // this can actually be supported, but should we?
      if (provider && provider !== options.provider) {
        throw new Error(`Cannot mix both "playwright" and "webdriverio" tests together.`)
      }

      if (options.provider === 'playwright' && options.name !== 'chromium') {
        throw new Error(
          `VSCode can only debug tests running in the "chromium" browser. ${testItem.label} runs in ${options.name} instead.`,
        )
      }
      if (options.provider === 'webdriverio' && options.name !== 'chrome' && options.name !== 'edge') {
        throw new Error(
          `VSCode can only debug tests running in the "chrome" or "edge" browser. ${testItem.label} runs in ${options.name} instead.`,
        )
      }
      if (options.provider === 'preview') {
        throw new Error(`Cannot debug tests running in the "preview" provider. Choose either "playwright" or "webdriverio" to be able to debug tests.`)
      }

      provider = options.provider
      browser = options.name
    }
    else if (data instanceof TestFolder) {
      testItem.children.forEach(traverse)
    }
    else if (data instanceof TestCase || data instanceof TestSuite) {
      if (testItem.parent) {
        traverse(testItem.parent)
      }
    }
  }

  if (request.include) {
    request.include.forEach(traverse)
  }
  else {
    controller.items.forEach(traverse)
  }

  return provider && browser ? { provider, browser } : null
}
