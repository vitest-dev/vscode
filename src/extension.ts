import * as vscode from 'vscode'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'
import { testControllerId } from './config'
import { TestFileDiscoverer } from './discover'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI } from './api'
import { GlobalTestRunner } from './runner/runner'

export async function activate(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders || []

  const start = performance.now()
  const api = await resolveVitestAPI(folders)

  if (!api || !folders.length) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

  const end = performance.now()
  log.info('[API]', `Vitest API resolved in ${end - start}ms`)

  const ctrl = vscode.tests.createTestController(testControllerId, 'Vitest')

  // TODO: check compatibility with version >= 0.34.0(?)
  // const workspaceConfigs = await getVitestWorkspaceConfigs()
  // // enable run/debug/watch tests only if vitest version >= 0.12.0
  // if (!workspacesCompatibilityCheck(workspaceConfigs)) {
  //   const msg = 'Because Vitest version < 0.12.0 for every workspace folder, run/debug/watch tests from Vitest extension disabled.\n'
  //   log.error(msg)
  //   // if the vitest detection is false positive, we may still reach here.
  //   // but we can still use `.version` to filter some false positive
  //   if (workspaceConfigs.some(x => x.isUsingVitestForSure))
  //     vscode.window.showWarningMessage(msg)

  // context.subscriptions.push(
  //   vscode.commands.registerCommand(Command.UpdateSnapshot, () => {
  //     vscode.window.showWarningMessage(msg)
  //   }),
  // )

  //   return
  // }

  const fileDiscoverer = registerDiscovery(folders, ctrl, context, api)
  const runner = new GlobalTestRunner(api, ctrl)

  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    (request, token) => runner.runTests(request, token),
    true,
    undefined,
    true,
  )

  ctrl.createRunProfile(
    'Debug Tests',
    vscode.TestRunProfileKind.Debug,
    (request, token) => runner.debugTests(request, token),
    false,
    undefined,
    true,
  )

  // registerRunDebugWatchHandler(ctrl, api, fileDiscoverer, context)
  context.subscriptions.push(
    api,
    ctrl,
    fileDiscoverer,
    runner,
    // vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
    //   updateSnapshot(ctrl, fileDiscoverer, test)
    // }),
    vscode.workspace.onDidOpenTextDocument((e) => {
      fileDiscoverer.discoverTestFromDoc(ctrl, e)
    }),
    vscode.workspace.onDidCloseTextDocument(async (e) => {
      const item = await fileDiscoverer.discoverTestFromDoc(ctrl, e)
      if (item)
        item.tags = item.tags.filter(x => x !== openTestTag)
    }),
    vscode.workspace.onDidChangeTextDocument(e =>
      fileDiscoverer.discoverTestFromDoc(ctrl, e.document),
    ),
    // TODO: update when folder is added/removed
  )
}

function registerDiscovery(folders: readonly vscode.WorkspaceFolder[], ctrl: vscode.TestController, context: vscode.ExtensionContext, api: VitestAPI) {
  const fileDiscoverer = new TestFileDiscoverer(folders, api)
  // run on refreshing test list
  ctrl.refreshHandler = async () => {
    await fileDiscoverer.discoverAllTestFilesInWorkspace(ctrl)
  }

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      // item == null, when user opened the testing panel
      // in this case, we should discover and watch all the testing files
      await fileDiscoverer.watchTestFilesInWorkspace(ctrl)
    }
    else {
      const data = WEAKMAP_TEST_DATA.get(item)
      if (data instanceof TestFile)
        await data.updateFromDisk(ctrl)
    }
  }

  vscode.window.visibleTextEditors.forEach(x =>
    fileDiscoverer.discoverTestFromDoc(ctrl, x.document),
  )

  fileDiscoverer.discoverAllTestFilesInWorkspace(ctrl)

  return fileDiscoverer
}

// export function deactivate() {}
