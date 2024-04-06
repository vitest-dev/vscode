import * as vscode from 'vscode'
import getPort from 'get-port'
import { log } from '../log'
import { getConfig } from '../config'
import type { TestRunner } from '../runner/runner'
import type { VitestFolderAPI } from '../api'
import { nanoid } from '../utils'
import type { TestDebugManager } from './debugManager'

export interface DebugSessionAPI {
  stop: () => Promise<void>
}

const DEBUG_DEFAULT_PORT = 9229

export async function startDebugSession(
  debug: TestDebugManager,
  api: VitestFolderAPI,
  runner: TestRunner,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const config = getConfig()
  const port = config.debuggerPort || await getPort({ port: DEBUG_DEFAULT_PORT })

  const inspectPromise = api.startInspect(port)

  const id = nanoid()

  const debugConfig = {
    type: 'pwa-node',
    request: 'attach',
    name: 'Debug Tests',
    port,
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    smartStep: true,
    __vitest: id,
    env: {
      ...process.env,
      VITEST_VSCODE: 'true',
    },
  }

  debug.configure(id, { request, runner, api, token })

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

  await inspectPromise
}
