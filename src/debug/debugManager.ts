import * as vscode from 'vscode'
import type { TestRunner } from '../runner/runner'
import type { VitestFolderAPI } from '../api'

interface VitestDebugConfig {
  request: vscode.TestRunRequest
  token: vscode.CancellationToken
  runner: TestRunner
  api: VitestFolderAPI
}

export class TestDebugManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private sessions = new Set<vscode.DebugSession>()
  private configurations = new Map<string, VitestDebugConfig>()

  constructor() {
    super(() => {
      this.disposables.forEach(d => d.dispose())
    })

    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        console.log('started', session)
        // the main attach session is called "Remote Process [0]"
        // https://github.com/microsoft/vscode-js-debug/blob/dfceaf103ce0cb83b53f1c3d88c06b8b63cb17da/src/targets/node/nodeAttacher.ts#L89
        // there are also other sessions that are spawned from the main session
        // but they have different names (like workers are named [worker #id])
        // I wonder how we could make it easier to make custom debug configurations here?
        // All this logic exists only because when "retry" is clicked, the main debug session is
        // not recreated, - instead it reattaches itself and this session is created again,
        // so we need to track that to correctly restart the tests
        if (!session.configuration.name.startsWith('Remote Process'))
          return
        const baseSession = this.getVitestSession(session)
        if (!baseSession)
          return
        const sym = baseSession.configuration.__vitest as string
        const config = this.configurations.get(sym)
        if (!config)
          return
        this.sessions.add(baseSession)
        // const { request, runner, token } = config
        // runner.runTests(request, token).catch((err: any) => {
        //   showVitestError('Failed to debug tests', err)
        // })
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        console.log('terminated', session)
        if (!session.configuration.__vitest)
          return
        this.sessions.delete(session)
        // const sym = session.configuration.__vitest as string
        // const config = this.configurations.get(sym)
        // if (!config)
        //   return
        // const { api } = config
        // api.cancelRun()
        // api.stopInspect()
      }),
    )
  }

  public configure(id: string, config: VitestDebugConfig) {
    this.configurations.set(id, config)
  }

  public async stop() {
    // await Promise.allSettled([...this.sessions].map(s => vscode.debug.stopDebugging(s)))
    this.configurations.clear()
  }

  private getVitestSession(session: vscode.DebugSession): vscode.DebugSession | undefined {
    if (session.configuration.__vitest)
      return session
    if (session.parentSession)
      return this.getVitestSession(session.parentSession)

    return undefined
  }
}
