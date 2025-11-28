import type { WorkerEvent, WorkerRunnerDebugOptions, WorkerRunnerOptions } from 'vitest-vscode-shared'
import type { WebSocket, WebSocketServer } from 'ws'
import type { ResolvedMeta } from '../api'
import type { VitestPackage } from './pkg'
import { pathToFileURL } from 'node:url'
import { gte } from 'semver'
import vscode from 'vscode'
import { getConfig } from '../config'
import { browserSetupFilePath, finalCoverageFileName, setupFilePath } from '../constants'
import { log } from '../log'
import { createVitestRpc } from './rpc'

export type WsConnectionMetadata = Omit<ResolvedMeta, 'process'> & {
  ws: WebSocket
}

export function waitForWsConnection(
  wss: WebSocketServer,
  pkg: VitestPackage,
  shellType: 'terminal' | 'child_process',
  hasShellIntegration: boolean,
) {
  return new Promise<WsConnectionMetadata>((resolve, reject) => {
    wss.once('connection', (ws) => {
      onWsConnection(
        ws,
        pkg,
        false,
        shellType,
        hasShellIntegration,
        meta => resolve(meta),
        err => reject(err),
      )

      wss.off('error', onUnexpectedError)
      wss.off('exit', onUnexpectedExit)
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

export function onWsConnection(
  ws: WebSocket,
  pkg: VitestPackage,
  debug: WorkerRunnerDebugOptions | boolean,
  shellType: 'terminal' | 'child_process',
  hasShellIntegration: boolean,
  onStart: (meta: WsConnectionMetadata) => unknown,
  onFail: (err: Error) => unknown,
) {
  function onMessage(_message: any) {
    const message = JSON.parse(_message.toString()) as WorkerEvent

    if (message.type === 'debug')
      log.worker('info', ...message.args)

    if (message.type === 'ready') {
      const { api, handlers } = createVitestRpc({
        on: listener => ws.on('message', listener),
        send: message => ws.send(message),
      })
      ws.once('close', () => {
        log.verbose?.('[API]', 'Vitest WebSocket connection closed, cannot call RPC anymore.')
        api.$close()
      })
      if (!message.legacy) {
        vscode.commands.executeCommand(
          'setContext',
          'vitest.environmentsSupported',
          true,
        )
      }
      onStart({
        rpc: api,
        workspaceSource: message.workspaceSource,
        handlers: {
          ...handlers,
          onStdout() {
            // do nothing by default
          },
        },
        configs: message.configs,
        ws,
        pkg,
      })
    }

    if (message.type === 'error') {
      const error = new Error(`Vitest failed to start: \n${message.error}`)
      onFail(error)
    }
    ws.off('error', onError)
    ws.off('message', onMessage)
    ws.off('close', onExit)
  }

  function onError(err: Error) {
    log.error('[API]', err)
    onFail(err)
    ws.off('error', onError)
    ws.off('message', onMessage)
    ws.off('close', onExit)
  }

  function onExit(code: number) {
    onFail(new Error(`Vitest process exited with code ${code}`))
  }

  ws.on('error', onError)
  ws.on('message', onMessage)
  ws.on('close', onExit)

  const pnpLoader = pkg.loader
  const pnp = pkg.pnp

  const runnerOptions: WorkerRunnerOptions = {
    type: 'init',
    meta: {
      shellType,
      hasShellIntegration,
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
      setupFilePaths: {
        watcher: setupFilePath,
        browserDebug: browserSetupFilePath,
      },
      finalCoverageFileName,
    },
    debug,
    astCollect: getConfig(pkg.folder).experimentalStaticAstCollect,
  }

  ws.send(JSON.stringify(runnerOptions))
}
