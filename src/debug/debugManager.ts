import * as vscode from 'vscode'
import getPort from 'get-port'
import { getConfig } from '../config'
import { log } from '../log'
import type { VitestFolderAPI } from '../api'

export class TestDebugManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private sessions = new Set<vscode.DebugSession>()
  private port: number | undefined

  private static DEBUG_DEFAULT_PORT = 9229

  constructor() {
    super(() => {
      this.disposables.forEach(d => d.dispose())
    })

    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        if (!session.configuration.__vitest)
          return
        this.sessions.add(session)
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (!session.configuration.__vitest)
          return
        this.sessions.delete(session)
      }),
    )
  }

  public async enable(api: VitestFolderAPI) {
    await this.stop()

    const config = getConfig()
    // TODO: remove "|| TestDebugManager.DEBUG_DEFAULT_PORT"
    this.port ??= config.debuggerPort || TestDebugManager.DEBUG_DEFAULT_PORT || await getPort({ port: TestDebugManager.DEBUG_DEFAULT_PORT })
    api.startInspect(this.port)
  }

  public async disable(api: VitestFolderAPI) {
    await this.stop()
    this.port = undefined
    api.stopInspect()
  }

  public start(folder: vscode.WorkspaceFolder) {
    const config = getConfig(folder)

    const debugConfig = {
      type: 'pwa-node',
      request: 'attach',
      name: 'Debug Tests',
      port: this.port,
      autoAttachChildProcesses: true,
      skipFiles: config.debugExclude,
      smartStep: true,
      __vitest: true,
      env: {
        ...process.env,
        VITEST_VSCODE: 'true',
      },
    }

    vscode.debug.startDebugging(
      folder,
      debugConfig,
      { suppressDebugView: true },
    ).then(
      (fulfilled) => {
        if (fulfilled)
          log.info('[DEBUG] Debugging started')
        else
          log.error('[DEBUG] Debugging failed')
      },
      (err) => {
        log.error('[DEBUG] Start debugging failed')
        log.error(err.toString())
      },
    )
  }

  public async stop() {
    await Promise.allSettled([...this.sessions].map(s => vscode.debug.stopDebugging(s)))
  }
}
