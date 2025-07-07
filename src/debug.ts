import type { VitestPackage } from './api/pkg'
import type { ExtensionWorkerProcess } from './api/types'
import type { WsConnectionMetadata } from './api/ws'
import type { ExtensionDiagnostic } from './diagnostic'
import type { TestTree } from './testTree'
import type { TestFile } from './testTreeData'
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
import { getTestData } from './testTreeData'
import { findNode } from './utils'

const DebugSessionName = 'Vitest'
const BrowserDebugSessionName = 'Vitest_Attach'

export async function debugTests(
  controller: vscode.TestController,
  tree: TestTree,
  api: VitestFolderAPI,
  diagnostic: ExtensionDiagnostic | undefined,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  debugManager: DebugManager,
) {
  const pkg = api.package
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`

  const config = getConfig(pkg.folder)
  const deferredPromise = Promise.withResolvers<void>()

  const { runtimeArgs, runtimeExecutable } = await getRuntimeOptions(pkg)
  const env = config.env || {}
  const logLevel = config.logLevel

  log.info('[DEBUG]', 'Starting debugging session', runtimeExecutable, ...(runtimeArgs || []))

  const debugConfig = {
    __name: DebugSessionName,
    type: config.shellType === 'terminal' ? 'node-terminal' : 'pwa-node',
    request: 'launch',
    name: 'Debug Tests',
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
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

  // If the debug request includes any test files belonging the browser-mode projects,
  // vitest needs to be started with the correct --inspect and --browser arguments.
  // Later, after debugging session starts, a secondary debug session is started; that session attaches to the launched browser instance.
  const { browserModeProjects, isPlaywright } = await api.getBrowserModeInfo()
  // When filters are applied through the test explorer, the result is represented as exclusion rather than inclusion.
  // When exclusions apply, root path is used and all but the excluded tests should be considered
  const includedTests = request.include?.length ? request.include : [{ uri: api.workspaceFolder.uri, parent: undefined }]
  const excludedTestIds = new Set(request?.exclude?.map(ex => ex.id) ?? [])
  const testProjects = includedTests?.filter(inc => inc.uri?.fsPath != null).flatMap(({ uri, parent }) => getProjectsFromTests(uri!.fsPath, parent, api, tree, excludedTestIds)) ?? []

  const needsBrowserMode = !!browserModeProjects?.length && testProjects.some(project => browserModeProjects?.includes(project))
  if (needsBrowserMode && !isPlaywright) {
    log.info('Browser mode debugging support is limited to Chrome with Playwright and Chromium with webdriverio. Additional project configuration is required for webdriverio debugger integration.')
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

  const browserModeLaunchArgs = needsBrowserMode ? getBrowserModeLaunchArgs(isPlaywright, config) : undefined

  wss.on(
    'connection',
    ws => onWsConnection(
      ws,
      pkg,
      true,
      config.shellType,
      false,
      browserModeLaunchArgs,
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
          )
          disposables.push(api, runner)

          token.onCancellationRequested(async () => {
            await metadata.rpc.close()
          })

          if (needsBrowserMode) {
            const browserModeAttachConfig = {
              __name: BrowserDebugSessionName,
              request: 'attach',
              name: 'Debug Tests (Browser)',
              port: config.debuggerPort ?? '9229',
              skipFiles: config.debugExclude,
              ...(
                config.debugOutFiles?.length
                  ? { outFiles: config.debugOutFiles }
                  : {}
              ),
              smartStep: true,
              cwd: pkg.cwd,
              type: 'chrome',
            }
            // Start secondary debug config before running test
            // Deliberately not awaiting, because attach config may depend on the test run to start (e.g. to attach)
            const parentSession = debugManager.sessions.entries().find(s => s[0].name === DebugSessionName)?.[0]
            vscode.debug.startDebugging(
              pkg.folder,
              browserModeAttachConfig,
              { parentSession, suppressDebugView: true },
            ).then(
              (fulfilled) => {
                if (fulfilled) {
                  log.info('[DEBUG] Secondary debug launch config started')
                }
                else {
                  log.error('[DEBUG] Secondary debug launch config failed')
                }
              },
              (err) => {
                log.error('[DEBUG] Secondary debug launch config failed')
                log.error(err.toString())
                deferredPromise.reject(new Error('Failed to start secondary launch config', { cause: err }))
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
    if (parent && parent.configuration.__name === DebugSessionName) {
      disposables.reverse().forEach(d => d.dispose())
      disposables.length = 0
    }
  })

  const onDidTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    // Child/secondary debug session should stop the main debugging session when in browser mode
    if (session?.configuration.__name === BrowserDebugSessionName) {
      vscode.debug.stopDebugging(session.parentSession)
      return
    }
    else if (session.configuration.__name !== DebugSessionName) {
      return
    }
    server.close()
    onDidTerminate.dispose()
    onDidWorkerTerminate.dispose()
  })

  await deferredPromise.promise
}

function getTestProjectsInFolder(path: string, api: VitestFolderAPI, tree: TestTree, exclude: Set<string>) {
  const folder = tree.getOrCreateFolderTestItem(api, path)
  const items = tree.getFolderFiles(folder)
  return items.map(item => (getTestData(item) as TestFile)).filter(testfile => !exclude.has(testfile.id)).map(tf => tf.project)
}

function getProjectsFromTests(fsPath: string, parentItem: vscode.TestItem | undefined, api: VitestFolderAPI, tree: TestTree, excluded: Set<string>): string[] {
  const items = getTestProjectsInFolder(fsPath, api, tree, excluded)
  if (items.length > 0) {
    return items
  }
  // Climb up tree until entry with project is found
  const parentPath = parentItem?.uri?.fsPath
  if (parentPath) {
    return getProjectsFromTests(parentPath, parentItem?.parent, api, tree, excluded)
  }
  return []
}

function getBrowserModeLaunchArgs(isPlaywright: boolean, config: { debuggerPort?: number; cliArguments?: string }): string {
  const browser = !config.cliArguments?.includes('--browser') ? `--browser=${isPlaywright ? 'chromium' : 'chrome'}` : ''
  // Only playwright provider supports --inspect currently
  const inspect = isPlaywright && !config.cliArguments?.includes('--inspect') ? `--inspect=localhost:${config.debuggerPort ?? '9229'}` : ''
  // regardless of user config, some properties need to be set when debugging with browser mode enabled
  return `vitest ${config.cliArguments ?? ''} ${inspect} ${browser}`
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
      const name = session.configuration.__name
      if (name === DebugSessionName || name === BrowserDebugSessionName) {
        this.sessions.add(session)
      }
    })

    vscode.debug.onDidTerminateDebugSession((session) => {
      this.sessions.delete(session)
    })
  }
}
