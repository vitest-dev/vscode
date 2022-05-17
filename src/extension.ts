import * as vscode from 'vscode'
import semver from 'semver'
import { effect } from '@vue/reactivity'
import { extensionId, getConfig } from './config'
import { TestFileDiscoverer } from './discover'
import { isVitestEnv } from './pure/isVitestEnv'
import { getVitestCommand, getVitestVersion } from './pure/utils'
import { debugHandler, runHandler, updateSnapshot } from './runHandler'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'
import { TestWatcher } from './watch'
import { Command } from './command'
import { StatusBarItem } from './StatusBarItem'

export async function activate(context: vscode.ExtensionContext) {
  if (
    vscode.workspace.workspaceFolders == null
    || vscode.workspace.workspaceFolders.length === 0
  )
    return

  if (
    !getConfig().enable
    && !(await isVitestEnv(vscode.workspace.workspaceFolders[0].uri.fsPath))
  )
    return

  const ctrl = vscode.tests.createTestController(`${extensionId}`, 'Vitest')

  const fileDiscoverer = new TestFileDiscoverer()
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

  const vitestCmd = getVitestCommand(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
  )
  const vitestVersion = await getVitestVersion(vitestCmd)
  console.dir({ vitestVersion })

  if (semver.gte(vitestVersion, '0.8.0')) {
    // enable run/debug/watch tests only if vitest version >= 0.8.0
    const testWatcher: undefined | TestWatcher = registerWatchHandler(
      vitestCmd,
      ctrl,
      fileDiscoverer,
      context,
    )
    registerRunHandler(ctrl, testWatcher)
  }
  else {
    // v0.8.0 introduce a breaking change in json format
    // https://github.com/vitest-dev/vitest/pull/1034
    // so we need to disable run & debug in version < 0.8.0
    vscode.window.showWarningMessage(
      'Because Vitest version < 0.8.0, run & debug tests from Vitest plugin disabled.\n',
    )
  }

  vscode.window.visibleTextEditors.forEach(x =>
    fileDiscoverer.discoverTestFromDoc(ctrl, x.document),
  )

  context.subscriptions.push(
    ctrl,
    // TODO
    // vscode.commands.registerCommand("vitest-explorer.configureTest", () => {
    //   vscode.window.showInformationMessage("Not implemented");
    // }),
    fileDiscoverer,
    vscode.workspace.onDidOpenTextDocument((e) => {
      fileDiscoverer.discoverTestFromDoc(ctrl, e)
    }),
    vscode.workspace.onDidChangeTextDocument(e =>
      fileDiscoverer.discoverTestFromDoc(ctrl, e.document),
    ),
    vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
      updateSnapshot(ctrl, test)
    }),
  )
}

let statusBarItem: StatusBarItem
function registerWatchHandler(
  vitestCmd: { cmd: string; args: string[] } | undefined,
  ctrl: vscode.TestController,
  fileDiscoverer: TestFileDiscoverer,
  context: vscode.ExtensionContext,
) {
  if (!vitestCmd)
    return

  const testWatcher = TestWatcher.create(ctrl, fileDiscoverer, vitestCmd)
  statusBarItem = new StatusBarItem()
  effect(() => {
    if (testWatcher.isRunning.value) {
      statusBarItem.toRunningMode()
      return
    }

    if (testWatcher.isWatching.value) {
      statusBarItem.toWatchMode(testWatcher.testStatus.value)
      return
    }

    statusBarItem.toDefaultMode()
  })

  const stopWatching = () => {
    testWatcher!.dispose()
    vscode.workspace
      .getConfiguration('testing')
      .update('automaticallyOpenPeekView', undefined)
  }
  const startWatching = () => {
    testWatcher!.watch()
    vscode.workspace
      .getConfiguration('testing')
      .update('automaticallyOpenPeekView', 'never')
  }

  context.subscriptions.push(
    {
      dispose: stopWatching,
    },
    testWatcher,
    statusBarItem,
    vscode.commands.registerCommand(Command.StartWatching, startWatching),
    vscode.commands.registerCommand(Command.StopWatching, stopWatching),
    vscode.commands.registerCommand(Command.ToggleWatching, () => {
      if (testWatcher.isWatching.value)
        stopWatching()
      else
        startWatching()
    }),
  )

  ctrl.createRunProfile(
    'Run Tests (Watch Mode)',
    vscode.TestRunProfileKind.Run,
    runHandler,
    false,
  )

  async function runHandler(
    request: vscode.TestRunRequest,
    _cancellation: vscode.CancellationToken,
  ) {
    if (
      vscode.workspace.workspaceFolders === undefined
      || vscode.workspace.workspaceFolders.length === 0
    )
      return

    await testWatcher.watch()
    testWatcher.runTests(request.include)
  }

  return testWatcher
}

function registerRunHandler(
  ctrl: vscode.TestController,
  testWatcher?: TestWatcher,
) {
  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl, testWatcher),
    true,
  )

  ctrl.createRunProfile(
    'Debug Tests',
    vscode.TestRunProfileKind.Debug,
    debugHandler.bind(null, ctrl),
    true,
  )
}

export function deactivate() {}
