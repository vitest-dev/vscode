import * as vscode from 'vscode'

// import { effect } from '@vue/reactivity'

// import { StatusBarItem } from './StatusBarItem'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'

// import { Command } from './command'
import { testControllerId } from './config'
import { TestFileDiscoverer } from './discover'
import { log } from './log'

// import {
//   debugHandler,
//   gatherTestItemsFromWorkspace,
//   runHandler,
//   updateSnapshot,
// } from './runHandler'
// import { TestWatcher } from './watch'

import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI } from './api'
import { GlobalTestRunner } from './runner/runner'

export async function activate(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders || []

  const api = await resolveVitestAPI(folders)

  if (!api) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

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

  const fileDiscoverer = registerDiscovery(ctrl, context, api)
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
  )
}

function registerDiscovery(ctrl: vscode.TestController, context: vscode.ExtensionContext, api: VitestAPI) {
  const fileDiscoverer = new TestFileDiscoverer(api)
  // run on refreshing test list
  ctrl.refreshHandler = async () => {
    await fileDiscoverer.discoverAllTestFilesInWorkspace(ctrl)
  }

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      // item == null, when user opened the testing panel
      // in this case, we should discover and watch all the testing files
      context.subscriptions.push(
        ...(await fileDiscoverer.watchAllTestFilesInWorkspace(ctrl)),
      )
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

// function aggregateTestWatcherStatuses(testWatchers: TestWatcher[]) {
//   return testWatchers.reduce((aggregate, watcher) => {
//     return {
//       passed: aggregate.passed + watcher.testStatus.value.passed,
//       failed: aggregate.failed + watcher.testStatus.value.failed,
//       skipped: aggregate.skipped + watcher.testStatus.value.skipped,
//     }
//   }, {
//     passed: 0,
//     failed: 0,
//     skipped: 0,
//   })
// }

// let statusBarItem: StatusBarItem
// function registerWatchHandlers(
//   api: VitestAPI,
//   ctrl: vscode.TestController,
//   fileDiscoverer: TestFileDiscoverer,
//   context: vscode.ExtensionContext,
// ) {
//   const testWatchers = api.map((folderApi, index) => {
//     const watcher = TestWatcher.create(
//       ctrl,
//       fileDiscoverer,
//       folderApi.folder,
//       index,
//       folderApi,
//     )

//     return watcher
//   }) ?? []

//   statusBarItem = new StatusBarItem()
//   effect(() => {
//     if (testWatchers.some(watcher => watcher.isRunning.value)) {
//       statusBarItem.toRunningMode()
//       return
//     }
//     else if (testWatchers.some(watcher => watcher.isWatching.value)) {
//       statusBarItem.toWatchMode(aggregateTestWatcherStatuses(testWatchers))
//       return
//     }

//     statusBarItem.toDefaultMode()
//   })

//   const stopWatching = () => {
//     testWatchers.forEach(watcher => watcher.dispose())
//   }
//   const startWatching = () => {
//     testWatchers.forEach(watcher => watcher.watch())
//   }

//   context.subscriptions.push(
//     {
//       dispose: stopWatching,
//     },
//     ...testWatchers,
//     statusBarItem,
//     vscode.commands.registerCommand(Command.StartWatching, startWatching),
//     vscode.commands.registerCommand(Command.StopWatching, stopWatching),
//     vscode.commands.registerCommand(Command.ToggleWatching, () => {
//       const anyWatching = testWatchers.some(watcher => watcher.isWatching.value)
//       if (anyWatching)
//         stopWatching()
//       else
//         startWatching()
//     }),
//   )

//   ctrl.createRunProfile(
//     'Run Tests (Watch Mode)',
//     vscode.TestRunProfileKind.Run,
//     runHandler,
//     false,
//     undefined,
//     true,
//   )

//   async function runHandler(
//     request: vscode.TestRunRequest,
//     _cancellation: vscode.CancellationToken,
//   ) {
//     if (
//       vscode.workspace.workspaceFolders === undefined
//       || vscode.workspace.workspaceFolders.length === 0
//     )
//       return

//     await Promise.all(testWatchers.map(watcher => watcher.watch()))
//     testWatchers.forEach((watcher) => {
//       watcher.runTests(gatherTestItemsFromWorkspace(request.include ?? [], watcher.workspace.uri.fsPath))
//     })
//   }

//   return testWatchers
// }

// function registerRunDebugWatchHandler(
//   ctrl: vscode.TestController,
//   api: VitestAPI,
//   fileDiscoverer: TestFileDiscoverer,
//   context: vscode.ExtensionContext,
// ) {
//   const testWatchers = registerWatchHandlers(
//     api,
//     ctrl,
//     fileDiscoverer,
//     context,
//   ) ?? []

//   ctrl.createRunProfile(
//     'Run Tests',
//     vscode.TestRunProfileKind.Run,
//     runHandler.bind(null, ctrl, fileDiscoverer, testWatchers, api),
//     true,
//   )

//   ctrl.createRunProfile(
//     'Debug Tests',
//     vscode.TestRunProfileKind.Debug,
//     debugHandler.bind(null, ctrl, fileDiscoverer, api),
//     true,
//   )
// }

// export function deactivate() {}
