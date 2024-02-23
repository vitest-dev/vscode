import * as vscode from 'vscode'
import { debugPath } from '../constants'
import { log } from '../log'
import { getConfig } from '../config'

export interface DebugSessionAPI {
  session: vscode.DebugSession | undefined
  stop: () => void
}

export function startDebugSession(
  folder: vscode.WorkspaceFolder,
  socketPath: string,
  vitestNodePath: string,
): DebugSessionAPI {
  let thisSession: vscode.DebugSession | undefined
  const terminateListeners: (() => void)[] = []
  const sessionApi: DebugSessionAPI = {
    get session() {
      return thisSession
    },
    stop() {
      if (thisSession)
        vscode.debug.stopDebugging(thisSession)
    },
  }
  const onStartDispose = vscode.debug.onDidStartDebugSession((session) => {
    thisSession = session
    onStartDispose.dispose()
  })
  const onTerminateDispose = vscode.debug.onDidTerminateDebugSession((session) => {
    if (thisSession !== session)
      return

    let timeout = false
    let restarted = false
    const onNewStartDispose = vscode.debug.onDidStartDebugSession((session) => {
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

  const config = getConfig(folder)

  vscode.debug.startDebugging(undefined, {
    type: 'pwa-node',
    request: 'launch',
    name: 'Debug Tests',
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    program: debugPath,
    args: [
      '--socket',
      socketPath,
      '--vitest-path',
      vitestNodePath,
      '--root',
      folder.uri.fsPath,
    ],
    smartStep: true,
    // TODO: custom env
    env: {
      VITEST_VSCODE: 'true',
    },
  }).then(() => {
    log.info('[DEBUG] Debugging started')
  }, (err) => {
    log.error('[DEBIG] Start debugging failed')
    log.error(err.toString())
    onStartDispose.dispose()
    onTerminateDispose.dispose()
  })

  log.info('[DEBUG] Running debug at', debugPath)

  return sessionApi
}
