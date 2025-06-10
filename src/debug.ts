import type { WebSocket } from 'ws'
import type { VitestPackage } from './api/pkg'
import type { ExtensionWorkerProcess } from './api/types'
import type { WsConnectionMetadata } from './api/ws'
import type { ExtensionDiagnostic } from './diagnostic'
import type { TestTree } from './testTree'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import getPort from 'get-port'
import * as vscode from 'vscode'
import { WebSocketServer } from 'ws'
import { VitestFolderAPI } from './api'
import { waitForWsConnection } from './api/ws'
import { getConfig } from './config'
import { workerPath } from './constants'
import { log } from './log'
import { TestRunner } from './runner'
import { findNode } from './utils'

export async function debugTests(
  controller: vscode.TestController,
  tree: TestTree,
  pkg: VitestPackage,
  diagnostic: ExtensionDiagnostic | undefined,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
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
    __name: 'Vitest',
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
          command: `${runtimeExecutable} ${workerPath}`,
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

  const onDidStart = vscode.debug.onDidStartDebugSession(async (session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    if (token.isCancellationRequested) {
      vscode.debug.stopDebugging(session)
      return
    }
    let metadata!: WsConnectionMetadata

    try {
      metadata = await waitForWsConnection(wss, pkg, true, config.shellType)
      const api = new VitestFolderAPI(pkg, {
        ...metadata,
        process: new ExtensionDebugProcess(session, metadata.ws),
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
        await vscode.debug.stopDebugging(session)
      })

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

    if (!token.isCancellationRequested) {
      await metadata?.rpc.close()
      await vscode.debug.stopDebugging(session)
    }
  })

  const onDidTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    disposables.reverse().forEach(d => d.dispose())
    server.close()
  })

  disposables.push(onDidStart, onDidTerminate)

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

  private _stopped: Promise<void>
  private _onDidExit = new vscode.EventEmitter<void>()

  constructor(
    private session: vscode.DebugSession,
    ws: WebSocket,
  ) {
    this._stopped = new Promise((resolve) => {
      const { dispose } = vscode.debug.onDidTerminateDebugSession((terminatedSession) => {
        if (session === terminatedSession) {
          this._onDidExit.fire()
          this._onDidExit.dispose()
          this.closed = true
          resolve()
          dispose()
        }
      })
    })
    // if websocket connection stopped working, close the debug session
    // otherwise it might hang indefinitely
    ws.on('close', () => {
      this.closed = true
      this.close()
    })
  }

  close() {
    vscode.debug.stopDebugging(this.session)
    return this._stopped
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
