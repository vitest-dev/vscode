import * as vscode from 'vscode'
import { log } from '../log'
import { getConfig } from '../config'
import type { VitestFolderAPI } from '../api'

export interface DebugSessionAPI {
  session: vscode.DebugSession | undefined
  stop: () => void
}

const DEBUG_DEFAULT_PORT = 9229

export async function startDebugSession(
  folderAPI: VitestFolderAPI,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
): Promise<DebugSessionAPI> {
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
  const onStartDispose = vscode.debug.onDidStartDebugSession(async (session) => {
    console.log('debug started new session', session.id, session.name)
    thisSession = session
    onStartDispose.dispose()
  })
  const onTerminateDispose = vscode.debug.onDidTerminateDebugSession(async (session) => {
    console.log('debug terminated', thisSession === session, session.id, session.name)
    if (thisSession !== session)
      return

    // await folderAPI.stopDebugger()

    let timeout = false
    let restarted = false
    const onNewStartDispose = vscode.debug.onDidStartDebugSession((session) => {
      console.log('new NEW session started')
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

  const config = getConfig(folderAPI.folder)

  await folderAPI.startDebugger(DEBUG_DEFAULT_PORT)

  vscode.debug.startDebugging(undefined, {
    type: 'pwa-node',
    request: 'attach',
    name: 'Debug Tests',
    processId: `${folderAPI.processId}:${DEBUG_DEFAULT_PORT}`,
    // processId: '${command:PickProcess}',
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    cwd: folderAPI.folder.uri.fsPath,
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
