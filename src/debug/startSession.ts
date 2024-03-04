import * as vscode from 'vscode'
import { log } from '../log'
import { getConfig } from '../config'
import type { GlobalTestRunner } from '../runner/runner'
import type { VitestAPI } from '../api'

export interface DebugSessionAPI {
  session: vscode.DebugSession | undefined
  stop: () => Promise<void>
}

const DEBUG_DEFAULT_PORT = 9229

export async function startDebugSession(
  api: VitestAPI,
  runner: GlobalTestRunner,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
): Promise<DebugSessionAPI> {
  let thisSession: vscode.DebugSession | undefined
  const terminateListeners: (() => void)[] = []
  const sessionApi: DebugSessionAPI = {
    get session() {
      return thisSession
    },
    async stop() {
      if (thisSession)
        await vscode.debug.stopDebugging(thisSession)
    },
  }
  // TODO: refactor this, with "attach", the session is actualy parentSession when "rerun" is triggered
  // TODO: run tests on "rerun" and "start"!
  const onStartDispose = vscode.debug.onDidStartDebugSession(async (session) => {
    thisSession = session
    onStartDispose.dispose()
    // await runner.runTests(request, token)
  })
  const onTerminateDispose = vscode.debug.onDidTerminateDebugSession(async (session) => {
    if (thisSession !== session && thisSession !== session.parentSession)
      return

    // await folderAPI.stopDebugger()

    let timeout = false
    let restarted = false
    const onNewStartDispose = vscode.debug.onDidStartDebugSession((session) => {
      // TODO: start running tests here?
      onNewStartDispose.dispose()
      // session.
      if (timeout)
        return

      restarted = true
      thisSession = session
    })

    setTimeout(() => {
      if (!restarted) {
        timeout = true
        onTerminateDispose.dispose()
        onNewStartDispose.dispose()
        thisSession = undefined
        terminateListeners.forEach(listener => listener())
      }
    }, 200)
  })

  const config = getConfig()

  api.startInspect(DEBUG_DEFAULT_PORT)

  vscode.debug.startDebugging(undefined, {
    type: 'pwa-node',
    request: 'attach',
    name: 'Debug Tests',
    processId: `${api.processId}:${DEBUG_DEFAULT_PORT}`,
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    smartStep: true,
    // TODO: custom env
    env: {
      VITEST_VSCODE: 'true',
    },
  }).then((fulfilled) => {
    if (fulfilled)
      log.info('[DEBUG] Debugging started')
    else
      log.error('[DEBUG] Debugging failed')
  }, (err) => {
    log.error('[DEBIG] Start debugging failed')
    log.error(err.toString())
    onStartDispose.dispose()
    onTerminateDispose.dispose()
  })

  return sessionApi
}
