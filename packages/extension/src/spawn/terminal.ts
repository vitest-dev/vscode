import type { Server } from 'node:http'
import type { WebSocket } from 'ws'
import type { ResolvedMeta } from '../apiProcess'
import type { VitestPackage } from './pkg'
import type { ExtensionWorkerProcess } from './types'
import type { ProcessSpawnOptions, WsConnectionMetadata } from './ws'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import getPort from 'get-port'
import * as vscode from 'vscode'
import { WebSocketServer } from 'ws'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import { createErrorLogger, log } from '../log'
import { formatPkg } from '../utils'
import { waitForWsConnection } from './ws'

export async function createVitestTerminalProcess(pkg: VitestPackage, options?: ProcessSpawnOptions): Promise<ResolvedMeta> {
  const pnpLoader = pkg.loader
  const pnp = pkg.pnp
  if (pnpLoader && !pnp)
    throw new Error('pnp file is required if loader option is used')
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
    name: 'vitest',
    shellArgs: config.terminalShellArgs,
    shellPath: config.terminalShellPath,
    env: {
      ...env,
      // Mark as CI to disable TTY
      CI: 'true',
      VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? config.logLevel,
      VITEST_WS_ADDRESS: wsAddress,
      VITEST_VSCODE: 'true',
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
    },
  })
  // TODO: make sure it is desposed even if it throws, the same for child_process

  const processId = await terminal.processId
  if (terminal.exitStatus && terminal.exitStatus.code != null) {
    throw new Error(`Terminal was ${getExitReason(terminal.exitStatus.reason)} with code ${terminal.exitStatus.code}`)
  }

  let command = 'node'
  if (pnpLoader && pnp) {
    command += ` --require ${pnp} --experimental-loader ${pathToFileURL(pnpLoader).toString()}`
  }
  command += ` ${workerPath};`

  log.info('[TERMINAL]', `Initiated ws connection via ${wsAddress}`)
  log.info('[TERMINAL]', `Starting ${formatPkg(pkg)} in the terminal: ${command}`)

  terminal.sendText(command, true)

  const meta = await new Promise<WsConnectionMetadata>((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminal.show(false)
      reject(new Error(`The extension could not connect to the terminal in 30 seconds. See the "vitest" terminal output for more details.`))
    }, 30_000)
    wss.once('connection', () => {
      clearTimeout(timeout)
    })
    waitForWsConnection(wss, pkg, 'terminal', options).then(resolve, reject)
  })

  meta.handlers.onProcessLog((type, message) => {
    log.worker(type === 'stderr' ? 'error' : 'info', message)
  })

  log.info('[API]', `${formatPkg(pkg)} terminal process ${processId} created`)
  const vitestProcess = new ExtensionTerminalProcess(
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
    projects: meta.projects,
    dispose: meta.dispose,
  }
}

function getExitReason(reason: vscode.TerminalExitReason) {
  switch (reason) {
    case vscode.TerminalExitReason.Extension:
      return 'clsoed by extension'
    case vscode.TerminalExitReason.Process:
      return 'closed by the process'
    case vscode.TerminalExitReason.Shutdown:
      return 'reloaded or closed'
    case vscode.TerminalExitReason.User:
      return 'closed by the user'
    case vscode.TerminalExitReason.Unknown:
    default:
      return 'unexpectedly closed'
  }
}

export class ExtensionTerminalProcess implements ExtensionWorkerProcess {
  private _onDidExit = new vscode.EventEmitter<number | null>()

  private stopped: Promise<void>

  constructor(
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

  private async close() {
    if (this.closed) {
      return
    }
    // send ctrl+c to sigint any running processs (vscode/#108289)
    this.terminal.sendText('\x03')
    // and then destroy it on the next event loop tick
    setTimeout(() => this.terminal.dispose(), 1)
    return this.stopped
  }

  onExit(listener: (code: number | null) => void) {
    const disposable = this._onDidExit.event(listener)
    return () => {
      disposable.dispose()
    }
  }
}
