import * as vscode from 'vscode'
import getPort from 'get-port'
import { log } from '../log'
import { getConfig } from '../config'
import { nanoid } from '../utils'

export interface DebugSessionAPI {
  stop: () => Promise<void>
}

const DEBUG_DEFAULT_PORT = 9229

export async function startDebugSession(
) {
  const config = getConfig()
  // TODO: test only DEBUG_DEFAULT_PORT for now
  const port = config.debuggerPort || DEBUG_DEFAULT_PORT || await getPort({ port: DEBUG_DEFAULT_PORT })

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
