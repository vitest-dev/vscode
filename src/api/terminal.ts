import type { Server } from 'node:http'
import type { WebSocket } from 'ws'
import type { ResolvedMeta } from '../api'
import type { VitestPackage } from './pkg'
import type { ExtensionWorkerProcess } from './types'
import { createServer } from 'node:http'
import getPort from 'get-port'
import * as vscode from 'vscode'
import { WebSocketServer } from 'ws'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import { createErrorLogger, log } from '../log'
import { formatPkg } from '../utils'
import { waitForWsConnection } from './ws'

export async function createVitestTerminalProcess(pkg: VitestPackage): Promise<ResolvedMeta> {
  const port = await getPort()
  const server = createServer().listen(port).unref()
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`
  const config = getConfig(pkg.folder)
  const env = config.env || {}
  const terminal = vscode.window.createTerminal({
    hideFromUser: true,
    cwd: pkg.cwd,
    isTransient: false,
    shellArgs: config.terminalShellArgs,
    shellPath: config.terminalShellPath,
    env: {
      ...env,
      VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? config.logLevel,
      VITEST_WS_ADDRESS: wsAddress,
      VITEST_VSCODE: 'true',
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
    },
  })
  const command = `node ${workerPath}`
  log.info('[API]', `Initiated ws connection via ${wsAddress}`)
  log.info('[API]', `Starting ${formatPkg(pkg)} in the terminal: ${command}`)
  terminal.sendText(command, true)
  const meta = await waitForWsConnection(wss, pkg, false, 'terminal')
  const processId = (await terminal.processId) ?? Math.random()
  log.info('[API]', `${formatPkg(pkg)} terminal process ${processId} created`)
  const vitestProcess = new ExtensionTerminalProcess(
    processId,
    terminal,
    server,
    meta.ws,
  )
  return {
    rpc: meta.rpc,
    handlers: meta.handlers,
    pkg,
    workspaceSource: meta.workspaceSource,
    process: vitestProcess,
    configs: meta.configs,
  }
}

export class ExtensionTerminalProcess implements ExtensionWorkerProcess {
  private _onDidExit = new vscode.EventEmitter<number | null>()

  private stopped: Promise<void>

  constructor(
    public readonly id: number,
    private readonly terminal: vscode.Terminal,
    server: Server,
    ws: WebSocket,
  ) {
    this.stopped = new Promise((resolve) => {
      const disposer = vscode.window.onDidCloseTerminal(async (e) => {
        if (e === terminal) {
          const exitCode = e.exitStatus?.code
          this._onDidExit.fire(exitCode ?? null)
          this._onDidExit.dispose()
          server.close(createErrorLogger('Failed to close server'))
          disposer.dispose()
          resolve()
        }
      })
    })
    ws.on('close', () => {
      this.close()
    })
  }

  show() {
    this.terminal.show(false)
  }

  get closed() {
    return this.terminal.exitStatus !== undefined
  }

  close() {
    if (this.closed) {
      return Promise.resolve()
    }
    // send ctrl+c to sigint any running processs (vscode/#108289)
    this.terminal.sendText('\x03')
    // and then destroy it on the next event loop tick
    setTimeout(() => this.terminal.dispose(), 1)
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('The extension terminal process did not exit in time.'))
      }, 5_000)
      this.stopped
        .finally(() => clearTimeout(timer))
        .then(resolve, reject)
    })
  }

  onError() {
    // do nothing
    return () => {
      // do nothing
    }
  }

  onExit(listener: (code: number | null) => void) {
    const disposable = this._onDidExit.event(listener)
    return () => {
      disposable.dispose()
    }
  }
}
