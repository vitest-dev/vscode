import { createServer } from 'node:http'
import * as vscode from 'vscode'
import getPort from 'get-port'
import { WebSocketServer } from 'ws'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import { log } from '../log'
import { formatPkg } from '../utils'
import type { ResolvedMeta } from '../api'
import type { VitestPackage } from './pkg'
import type { VitestWebSocketProcess } from './ws'
import { waitForWsResolvedMeta } from './ws'
import type { VitestProcess } from './types'

export async function createVitestTerminalProcess(pkg: VitestPackage): Promise<ResolvedMeta> {
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`
  const config = getConfig(pkg.folder)
  const env = config.env || {}
  const terminal = vscode.window.createTerminal({
    hideFromUser: true,
    cwd: pkg.folder.uri,
    isTransient: false,
    shellArgs: config.terminalShellArgs,
    shellPath: config.terminalShellPath,
    env: {
      ...env,
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
  const meta = await waitForWsResolvedMeta(wss, pkg, false, 'terminal')
  const processId = (await terminal.processId) ?? meta.process.id
  log.info('[API]', `${formatPkg(pkg)} terminal process ${processId} created`)
  const vitestProcess = new VitestTerminalProcess(
    processId,
    meta.process as VitestWebSocketProcess,
    terminal,
  )
  return {
    rpc: meta.rpc,
    handlers: meta.handlers,
    pkg,
    process: vitestProcess,
    configs: meta.configs,
  }
}

export class VitestTerminalProcess implements VitestProcess {
  constructor(
    public readonly id: number,
    private wsProcess: VitestWebSocketProcess,
    private readonly terminal: vscode.Terminal,
  ) {
    const disposer = vscode.window.onDidCloseTerminal(async (e) => {
      if (e === terminal) {
        const exitCode = e.exitStatus?.code
        // TODO: have a single emitter, don't reuse ws one
        // this event is required for api.dispose() and onUnexpectedExit
        wsProcess.ws.emit('exit', exitCode)
        disposer.dispose()
      }
    })
  }

  show() {
    this.terminal.show(false)
  }

  get closed() {
    return this.wsProcess.closed || this.terminal.exitStatus !== undefined
  }

  close() {
    this.wsProcess.close()
    this.terminal.dispose()
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.wsProcess.on(event, listener)
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.wsProcess.on(event, listener)
  }

  once(event: string, listener: (...args: any[]) => void) {
    this.wsProcess.once(event, listener)
  }
}
