import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import getPort from 'get-port'
import { getConfig } from '../config'
import { log } from '../log'
import type { VitestFolderAPI } from '../api'

export class TestDebugManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private sessions = new Map<string, vscode.DebugSession>()
  private port: number | undefined
  private address: string | undefined

  private static DEBUG_DEFAULT_PORT = 9229

  private configurations = new Map<string, TestDebugConfiguration>()

  constructor() {
    super(() => {
      this.disposables.forEach(d => d.dispose())
    })

    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => {
        const id = session.configuration.__vitest
        if (id)
          this.sessions.set(id, session)
      }),
      vscode.debug.onDidTerminateDebugSession((session) => {
        const id = session.configuration.__vitest
        if (id) {
          this.sessions.delete(id)
          this.configurations.get(id)?.resolve()
          this.configurations.delete(id)
          return
        }
        const vitestId = session.parentSession && session.parentSession.configuration.__vitest
        if (!vitestId || !session.configuration.name.startsWith('Remote Process'))
          return

        // I am going insane with this debugging API
        // For long-running tests this line just stops the debugger,
        // For fast tests this will rerun the suite correctly
        const configuration = this.configurations.get(vitestId)
        configuration?.stopTests().then(() => {
          setTimeout(() => {
            // if configuration is not empty, it means that the tests are still running
            const configuration = this.configurations.get(vitestId)
            if (configuration)
              configuration.runTests()
          }, 50)
        })
      }),
    )
  }

  public async enable(api: VitestFolderAPI) {
    await this.stopDebugging()

    const config = getConfig()
    this.port ??= config.debuggerPort || await getPort({ port: TestDebugManager.DEBUG_DEFAULT_PORT })
    this.address ??= config.debuggerAddress
    await api.startInspect(this.port)
  }

  public async disable(api: VitestFolderAPI) {
    await this.stopDebugging()
    this.port = undefined
    this.address = undefined
    api.stopInspect()
  }

  public startDebugging(
    runTests: () => Promise<void>,
    stopTests: () => Promise<void>,
    folder: vscode.WorkspaceFolder,
  ) {
    const config = getConfig(folder)

    const uniqueId = randomUUID()
    let _resolve: () => void
    let _reject: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      _resolve = resolve
      _reject = reject
    })
    this.configurations.set(uniqueId, {
      runTests,
      stopTests,
      resolve: _resolve!,
      reject: _reject!,
    })

    const debugConfig = {
      type: 'pwa-node',
      request: 'attach',
      name: 'Debug Tests',
      port: this.port,
      address: this.address,
      autoAttachChildProcesses: true,
      skipFiles: config.debugExclude,
      smartStep: true,
      __vitest: uniqueId,
      env: {
        ...process.env,
        VITEST_VSCODE: 'true',
      },
    }

    log.info(`[DEBUG] Starting debugging on ${debugConfig.address || 'localhost'}:${debugConfig.port}`)

    vscode.debug.startDebugging(
      folder,
      debugConfig,
      { suppressDebugView: true },
    ).then(
      (fulfilled) => {
        if (fulfilled) {
          log.info('[DEBUG] Debugging started')
        }
        else {
          _reject(new Error('Failed to start debugging. See output for more information.'))
          log.error('[DEBUG] Debugging failed')
        }
      },
      (err) => {
        _reject(new Error('Failed to start debugging', { cause: err }))
        log.error('[DEBUG] Start debugging failed')
        log.error(err.toString())
      },
    )

    runTests()

    return promise
  }

  public async stopDebugging() {
    await Promise.allSettled([...this.sessions].map(([, s]) => vscode.debug.stopDebugging(s)))
  }
}

interface TestDebugConfiguration {
  runTests: () => Promise<void>
  stopTests: () => Promise<void>

  resolve: () => void
  reject: (error: Error) => void
}
