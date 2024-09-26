import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import WebSocket, { WebSocketServer } from 'ws'
import getPort from 'get-port'
import { gte } from 'semver'
import type { ResolvedMeta } from '../api'
import { VitestFolderAPI } from '../api'
import type { VitestPackage } from '../api/pkg'
import { createVitestRpc } from '../api/rpc'
import type { VitestProcess } from '../process'
import type { TestTree } from '../testTree'
import { log } from '../log'
import { getConfig } from '../config'
import type { WorkerEvent, WorkerRunnerOptions } from '../worker/types'
import { TestRunner } from '../runner/runner'
import { findNode } from '../utils'
import { debuggerPath } from '../constants'

export async function debugTests(
  controller: vscode.TestController,
  tree: TestTree,
  pkg: VitestPackage,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`

  const config = getConfig(pkg.folder)
  const promise = Promise.withResolvers<void>()

  const execPath = await findNode(
    vscode.workspace.workspaceFile?.fsPath || pkg.folder.uri.fsPath,
  )
  const env = config.env || {}
  const logLevel = config.logLevel

  const debugConfig = {
    __name: 'Vitest',
    type: 'pwa-node',
    request: 'launch',
    name: 'Debug Tests',
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    smartStep: true,
    runtimeExecutable: execPath,
    program: debuggerPath,
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
        promise.reject(new Error('Failed to start debugging. See output for more information.'))
        log.error('[DEBUG] Debugging failed')
      }
    },
    (err) => {
      promise.reject(new Error('Failed to start debugging', { cause: err }))
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
    let vitest!: ResolvedMeta

    try {
      vitest = await startWebsocketServer(wss, pkg)
      const api = new VitestFolderAPI(pkg, vitest)
      const runner = new TestRunner(
        controller,
        tree,
        api,
      )
      disposables.push(api, runner)

      token.onCancellationRequested(async () => {
        await vitest.rpc.close()
        await vscode.debug.stopDebugging(session)
      })

      await runner.runTests(request, token)

      promise.resolve()
    }
    catch (err) {
      promise.reject(err)
    }

    if (!token.isCancellationRequested) {
      await vitest?.rpc.close()
      await vscode.debug.stopDebugging(session)
    }
  })

  const onDidTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    disposables.forEach(d => d.dispose())
    server.close()
  })

  disposables.push(onDidStart, onDidTerminate)

  await promise.promise
}

function startWebsocketServer(wss: WebSocketServer, pkg: VitestPackage) {
  return new Promise<ResolvedMeta>((resolve, reject) => {
    wss.once('connection', (ws) => {
      function onMessage(_message: any) {
        const message = JSON.parse(_message.toString()) as WorkerEvent

        if (message.type === 'debug')
          log.worker('info', ...message.args)

        if (message.type === 'ready') {
          const { api, handlers } = createVitestRpc({
            on: listener => ws.on('message', listener),
            send: message => ws.send(message),
          })
          resolve({
            rpc: api,
            handlers,
            process: new VitestWebSocketProcess(Math.random(), wss, ws),
            pkg,
          })
        }

        if (message.type === 'error') {
          const error = new Error(`Vitest failed to start: \n${message.error}`)
          reject(error)
        }
        ws.off('error', onError)
        ws.off('message', onMessage)
        ws.off('close', onExit)
      }

      function onError(err: Error) {
        log.error('[API]', err)
        reject(err)
        ws.off('error', onError)
        ws.off('message', onMessage)
        ws.off('close', onExit)
      }

      function onExit(code: number) {
        reject(new Error(`Vitest process exited with code ${code}`))
      }

      wss.off('error', onUnexpectedError)
      wss.off('exit', onUnexpectedExit)

      ws.on('error', onError)
      ws.on('message', onMessage)
      ws.on('close', onExit)

      const pnpLoader = pkg.loader
      const pnp = pkg.pnp

      const runnerOptions: WorkerRunnerOptions = {
        type: 'init',
        meta: {
          vitestNodePath: pkg.vitestNodePath,
          env: getConfig(pkg.folder).env || undefined,
          configFile: pkg.configFile,
          cwd: pkg.cwd,
          arguments: pkg.arguments,
          workspaceFile: pkg.workspaceFile,
          id: pkg.id,
          pnpApi: pnp,
          pnpLoader: pnpLoader && gte(process.version, '18.19.0')
            ? pathToFileURL(pnpLoader).toString()
            : undefined,
        },
      }

      ws.send(JSON.stringify(runnerOptions))
    })

    function onUnexpectedExit() {
      reject(new Error('Cannot establish connection with Vitest process.'))
    }

    function onUnexpectedError(err: Error) {
      reject(err)
    }

    wss.on('error', onUnexpectedError)
    wss.once('close', onUnexpectedExit)
  })
}

class VitestWebSocketProcess implements VitestProcess {
  constructor(
    public id: number,
    private wss: WebSocketServer,
    private ws: WebSocket,
  ) {}

  get closed() {
    return this.ws.readyState === WebSocket.CLOSED
  }

  close() {
    this.wss.close()
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.ws.on(event, listener)
  }

  once(event: string, listener: (...args: any[]) => void) {
    this.ws.once(event, listener)
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.ws.off(event, listener)
  }
}
