import * as vscode from 'vscode'
import { getConfig } from '../config'
import { log } from '../log'
import type { VitestPackage } from '../api/pkg'
import { findNode } from '../utils'
import { debuggerPath } from '../constants'

export class TestDebugManager extends vscode.Disposable {
  private _enabled = false

  constructor() {
    super(() => {
      // TODO
    })
  }

  public stop() {
    this._enabled = false
  }

  public async startDebugging(
    pkg: VitestPackage,
    wsAddress: string,
  ) {
    const config = getConfig(pkg.folder)
    // this.port ??= config.debuggerPort || await getPort({ port: TestDebugManager.DEBUG_DEFAULT_PORT })
    // this.address ??= config.debuggerAddress
    const promise = Promise.withResolvers<void>()

    const execPath = getConfig().nodeExecutable || await findNode(vscode.workspace.workspaceFile?.fsPath || pkg.folder.uri.fsPath)
    const env = config.env || {}

    const debugConfig = {
      type: 'pwa-node',
      request: 'launch',
      name: 'Debug Tests',
      // port: this.port,
      // address: this.address,
      autoAttachChildProcesses: true,
      skipFiles: config.debugExclude,
      smartStep: true,
      runtimeExecutable: execPath,
      program: debuggerPath,
      __name: 'Vitest',
      env: {
        ...process.env,
        ...env,
        VITEST_VSCODE: 'true',
        VITEST_WS_ADDRESS: wsAddress,
        // same env var as `startVitest`
        // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
        TEST: 'true',
        VITEST: 'true',
        NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
      },
    }

    log.info(`[DEBUG] Starting debugging`)

    vscode.debug.startDebugging(
      pkg.folder,
      debugConfig,
      { suppressDebugView: true },
    ).then(
      (fulfilled) => {
        if (fulfilled) {
          log.info('[DEBUG] Debugging started')
          promise.resolve()
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

    this._enabled = true

    return promise
  }

  public get enabled() {
    return this._enabled
  }
}
