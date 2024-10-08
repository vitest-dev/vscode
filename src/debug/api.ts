import { createServer } from 'node:http'
import * as vscode from 'vscode'
import { WebSocketServer } from 'ws'
import getPort from 'get-port'
import type { ResolvedMeta } from '../api'
import { VitestFolderAPI } from '../api'
import type { VitestPackage } from '../api/pkg'
import type { TestTree } from '../testTree'
import { log } from '../log'
import { getConfig } from '../config'
import { TestRunner } from '../runner/runner'
import { findNode } from '../utils'
import { workerPath } from '../constants'
import { waitForWsResolvedMeta } from '../api/ws'

export async function debugTests(
  controller: vscode.TestController,
  tree: TestTree,
  pkg: VitestPackage,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`

  const config = getConfig(pkg.folder)
  const promise = Promise.withResolvers<void>()

  const execPath = await findNode(
    vscode.workspace.workspaceFile?.fsPath || pkg.folder.uri.fsPath,
  )
  const env = config.env || {}
  const logLevel = config.logLevel

  const debugConfig = {
    __name: 'Vitest',
    type: 'pwa-node',
    request: 'launch',
    name: 'Debug Tests',
    autoAttachChildProcesses: true,
    skipFiles: config.debugExclude,
    smartStep: true,
    runtimeExecutable: execPath,
    program: workerPath,
    cwd: pkg.cwd,
    env: {
      ...process.env,
      ...env,
      VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? logLevel,
      VITEST_VSCODE: 'true',
      VITEST_WS_ADDRESS: wsAddress,
      // same env var as `startVitest`
      // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
    },
  }

  vscode.debug.startDebugging(
    pkg.folder,
    debugConfig,
    { suppressDebugView: true },
  ).then(
    (fulfilled) => {
      if (fulfilled) {
        log.info('[DEBUG] Debugging started')
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

  const disposables: vscode.Disposable[] = []

  const onDidStart = vscode.debug.onDidStartDebugSession(async (session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    if (token.isCancellationRequested) {
      vscode.debug.stopDebugging(session)
      return
    }
    let vitest!: ResolvedMeta

    try {
      vitest = await waitForWsResolvedMeta(wss, pkg, true)
      const api = new VitestFolderAPI(pkg, vitest)
      const runner = new TestRunner(
        controller,
        tree,
        api,
      )
      disposables.push(api, runner)

      token.onCancellationRequested(async () => {
        await vitest.rpc.close()
        await vscode.debug.stopDebugging(session)
      })

      await runner.runTests(request, token)

      promise.resolve()
    }
    catch (err) {
      promise.reject(err)
    }

    if (!token.isCancellationRequested) {
      await vitest?.rpc.close()
      await vscode.debug.stopDebugging(session)
    }
  })

  const onDidTerminate = vscode.debug.onDidTerminateDebugSession((session) => {
    if (session.configuration.__name !== 'Vitest')
      return
    disposables.forEach(d => d.dispose())
    server.close()
  })

  disposables.push(onDidStart, onDidTerminate)

  await promise.promise
}
