import { createServer } from 'node:http'
import * as vscode from 'vscode'
import WebSocket, { WebSocketServer } from 'ws'
import getPort from 'get-port'
import type { ResolvedMeta } from '../api'
import { VitestFolderAPI } from '../api'
import type { VitestPackage } from '../api/pkg'
import { createVitestRpc } from '../api/rpc'
import type { VitestProcess } from '../process'
import type { TestTree } from '../testTree'
import { log } from '../log'
import { getConfig } from '../config'
import type { WorkerRunnerOptions } from '../worker/types'
import { TestRunner } from '../runner/runner'
import type { TestDebugManager } from './debugManager'

export async function createDebugAPI(
  controller: vscode.TestController,
  tree: TestTree,
  debugManager: TestDebugManager,
  pkg: VitestPackage,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const address = `ws://localhost:${port}`

  debugManager.startDebugging(pkg, address)

  // TODO: dispose this when debugging is stopped
  vscode.debug.onDidStartDebugSession(async (session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    // TODO
    if (token.isCancellationRequested) {
      vscode.debug.stopDebugging()
      return
    }
    const vitest = await startWebsocketServer(wss, pkg)
    const api = new VitestFolderAPI(pkg, vitest)
    const runner = new TestRunner(
      controller,
      tree,
      api,
      debugManager,
    )
    await runner.runTests(request, token)
    await vitest.rpc.close()
    await vscode.debug.stopDebugging(session)
  })

  vscode.debug.onDidTerminateDebugSession((_session) => {
    if (_session.configuration.__name !== 'Vitest')
      return
    debugManager.stop()
  })
}

function startWebsocketServer(wss: WebSocketServer, pkg: VitestPackage) {
  return new Promise<ResolvedMeta>((resolve, reject) => {
    wss.once('connection', (ws) => {
      function ready(_message: any) {
        const message = JSON.parse(_message.toString())

        if (message.type === 'debug')
          log.worker('info', ...message.args)

        if (message.type === 'ready') {
          ws.off('message', ready)
          const { api, handlers } = createVitestRpc({
            on: listener => ws.on('message', listener),
            send: message => ws.send(message),
          })
          resolve({
            rpc: api,
            handlers,
            process: new VitestWebSocketProcess(Math.random(), wss, ws),
            packages: [pkg],
          })
        }
        if (message.type === 'error') {
          ws.off('message', ready)
          const error = new Error(`Vitest failed to start: \n${message.errors.map((r: any) => r[1]).join('\n')}`)
          reject(error)
        }
        ws.off('error', error)
        ws.off('message', ready)
        ws.off('close', exit)
      }

      function error(err: Error) {
        log.error('[API]', err)
        reject(err)
        ws.off('error', error)
        ws.off('message', ready)
        ws.off('close', exit)
      }

      function exit(code: number) {
        reject(new Error(`Vitest process exited with code ${code}`))
      }

      ws.on('error', error)
      ws.on('message', ready)
      ws.on('close', exit)

      const runnerOptions: WorkerRunnerOptions = {
        type: 'init',
        meta: [
          {
            vitestNodePath: pkg.vitestNodePath,
            env: getConfig(pkg.folder).env || undefined,
            configFile: pkg.configFile,
            cwd: pkg.cwd,
            arguments: pkg.arguments,
            workspaceFile: pkg.workspaceFile,
            id: pkg.id,
          },
        ],
      }

      ws.send(JSON.stringify(runnerOptions))
    })
    wss.on('error', err => reject(err))
    // TODO close if unexpected
    // wss.once('close', () => reject(err))
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
}
