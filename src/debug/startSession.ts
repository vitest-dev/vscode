import * as vscode from 'vscode'
import getPort from 'get-port'
import { log } from '../log'
import { getConfig } from '../config'
import type { TestRunner } from '../runner/runner'
import type { VitestFolderAPI } from '../api'

export interface DebugSessionAPI {
  session: vscode.DebugSession | undefined
  stop: () => Promise<void>
}

const DEBUG_DEFAULT_PORT = 9229

export async function startDebugSession(
  api: VitestFolderAPI,
  runner: TestRunner,
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
      if (baseSession === mainSession) {
        runner.runTests(request, token)
          .catch((e) => {
            if (!e.message.includes('timeout on calling'))
              log.error('Error while running tests', e)
          })
      }
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
      if (restarted)
        return

      timeout = true
      onTerminateDispose.dispose()
      onNewStartDispose.dispose()
      mainSession = undefined
      api.stopInspect()
      // Vitest has 60s of waiting for RPC, and it never resolves when running with debugger, so we manually stop all runs
      // runner.endTestRuns()
    }, 100)
  })

  const config = getConfig()
  const port = await getPort({ port: DEBUG_DEFAULT_PORT })

  api.startInspect(port)

  vscode.debug.startDebugging(undefined, {
    type: 'pwa-node',
    request: 'attach',
    name: 'Debug Tests',
    processId: `${api.processId}:${port}`,
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    __vitest_name: 'vitest-debug',
    smartStep: true,
    env: {
      VITEST_VSCODE: 'true',
    },
  }).then((fulfilled) => {
    if (fulfilled)
      log.info('[DEBUG] Debugging started')
    else
      log.error('[DEBUG] Debugging failed')
  }, (err) => {
    log.error('[DEBUG] Start debugging failed')
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
