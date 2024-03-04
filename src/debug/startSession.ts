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
  let mainSession: vscode.DebugSession | undefined
  const onStartDispose = vscode.debug.onDidStartDebugSession((session) => {
    mainSession = session
    onStartDispose.dispose()
  })
  const onRerunDispose = vscode.debug.onDidStartDebugSession(async (session) => {
    const baseSession = session.parentSession || session
    // check if not terminated
    setTimeout(() => {
      if (baseSession === mainSession)
        runner.runTests(request, token)
    }, 150)
  })
  const onTerminateDispose = vscode.debug.onDidTerminateDebugSession(async (session) => {
    if (mainSession !== session)
      return

    let timeout = false
    let restarted = false
    const onNewStartDispose = vscode.debug.onDidStartDebugSession((session) => {
      onNewStartDispose.dispose()
      // session.
      if (timeout)
        return

      restarted = true
      mainSession = session
    })

    setTimeout(() => {
      if (!restarted) {
        timeout = true
        onTerminateDispose.dispose()
        onNewStartDispose.dispose()
        mainSession = undefined
        api.stopInspect()
      }
    }, 100)
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
    __vitest_name: 'vitest-debug',
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

  return <DebugSessionAPI>{
    get session() {
      return mainSession
    },
    async stop() {
      if (mainSession)
        await vscode.debug.stopDebugging(mainSession)
      onStartDispose.dispose()
      onTerminateDispose.dispose()
      onRerunDispose.dispose()
      api.stopInspect()
    },
  }
}
