import * as vscode from 'vscode'
import getPort from 'get-port'
import { getConfig } from '../config'
import { log } from '../log'

export class TestDebugManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private sessions = new Set<vscode.DebugSession>()

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

  public async start(defaultPort?: number) {
    const config = getConfig()
    // TODO: test only DEBUG_DEFAULT_PORT for now
    const port = defaultPort || config.debuggerPort || TestDebugManager.DEBUG_DEFAULT_PORT || await getPort({ port: TestDebugManager.DEBUG_DEFAULT_PORT })

    const debugConfig = {
      type: 'pwa-node',
      request: 'attach',
      name: 'Debug Tests',
      port,
      autoAttachChildProcesses: true,
      skipFiles: config.debugExclude,
      smartStep: true,
      __vitest: true,
      env: {
        ...process.env,
        VITEST_VSCODE: 'true',
      },
    }

    vscode.debug.startDebugging(undefined, debugConfig, {
      suppressDebugView: true,
    }).then((fulfilled) => {
      if (fulfilled)
        log.info('[DEBUG] Debugging started')
      else
        log.error('[DEBUG] Debugging failed')
    }, (err) => {
      log.error('[DEBUG] Start debugging failed')
      log.error(err.toString())
    })
  }

  public async stop() {
    await Promise.allSettled([...this.sessions].map(s => vscode.debug.stopDebugging(s)))
  }
}
