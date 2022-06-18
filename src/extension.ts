import * as vscode from 'vscode'
import semver from 'semver'
import { effect } from '@vue/reactivity'
import { detectVitestEnvironmentFolders, extensionId, getConfig, vitestEnvironmentFolders } from './config'
import { TestFileDiscoverer } from './discover'
import { getVitestCommand, getVitestVersion, isNodeAvailable, negate } from './pure/utils'
import { debugHandler, gatherTestItemsFromWorkspace, runHandler, updateSnapshot } from './runHandler'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'
import { TestWatcher } from './watch'
import { Command } from './command'
import { StatusBarItem } from './StatusBarItem'
import { log } from './log'

export async function activate(context: vscode.ExtensionContext) {
  await detectVitestEnvironmentFolders()
  if (vitestEnvironmentFolders.length === 0) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

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

  const vitestRunConfigs: {
    workspace: vscode.WorkspaceFolder
    cmd: string
    args: string[]
    version: string | null
  }[] = await Promise.all(vitestEnvironmentFolders.map(async (folder) => {
    const cmd = getVitestCommand(folder.uri.fsPath)

    const version = await getVitestVersion(cmd, getConfig(folder).env || undefined).catch(async (e) => {
      log.info(e.toString())
      log.info(`process.env.PATH = ${process.env.PATH}`)
      log.info(`vitest.nodeEnv = ${JSON.stringify(getConfig(folder).env)}`)
      let errorMsg = e.toString()
      if (!isNodeAvailable(getConfig(folder).env || undefined)) {
        log.info('Cannot spawn node process')
        errorMsg += 'Cannot spawn node process. Please try setting vitest.nodeEnv as {"PATH": "/path/to/node"} in your settings.'
      }

      vscode.window.showErrorMessage(errorMsg)
    })

    return cmd
      ? {
          cmd: cmd.cmd,
          args: cmd.args,
          workspace: folder,
          version: version ?? null,
        }
      : {
          cmd: 'npx',
          args: ['vitest'],
          workspace: folder,
          version: version ?? null,
        }
  }))

  vitestRunConfigs.forEach((vitest) => {
    log.info(`Vitest Workspace [${vitest.workspace.name}]: Vitest version = ${vitest.version}`)
  })

  const isCompatibleVitestConfig = (config: typeof vitestRunConfigs[number]) =>
    (config.version && semver.gte(config.version, '0.8.0')) || getConfig(config.workspace).commandLine

  vitestRunConfigs.filter(negate(isCompatibleVitestConfig)).forEach((config) => {
    vscode.window.showWarningMessage(`Because Vitest version < 0.8.0 for ${config.workspace.name} `
    + ', run/debug/watch tests from Vitest extension disabled for that workspace.\n')
  })

  if (vitestRunConfigs.every(negate(isCompatibleVitestConfig))) {
    const msg = 'Because Vitest version < 0.8.0 for every workspace folder, run/debug/watch tests from Vitest extension disabled.\n'
    context.subscriptions.push(
      vscode.commands.registerCommand(Command.ToggleWatching, () => {
        vscode.window.showWarningMessage(msg)
      }),
      vscode.commands.registerCommand(Command.UpdateSnapshot, () => {
        vscode.window.showWarningMessage(msg)
      }),
    )
    // v0.8.0 introduce a breaking change in json format
    // https://github.com/vitest-dev/vitest/pull/1034
    // so we need to disable run & debug in version < 0.8.0
    vscode.window.showWarningMessage(msg)
  }

  // enable run/debug/watch tests only if vitest version >= 0.8.0
  const testWatchers = registerWatchHandlers(
    vitestRunConfigs.filter(isCompatibleVitestConfig),
    ctrl,
    fileDiscoverer,
    context,
  ) ?? []
  registerRunHandler(ctrl, testWatchers)
  context.subscriptions.push(
    vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
      updateSnapshot(ctrl, test)
    }),
  )

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
  )
}

function aggregateTestWatcherStatuses(testWatchers: TestWatcher[]) {
  return testWatchers.reduce((aggregate, watcher) => {
    return {
      passed: aggregate.passed + watcher.testStatus.value.passed,
      failed: aggregate.failed + watcher.testStatus.value.failed,
      skipped: aggregate.skipped + watcher.testStatus.value.skipped,
    }
  }, {
    passed: 0,
    failed: 0,
    skipped: 0,
  })
}

let statusBarItem: StatusBarItem
function registerWatchHandlers(
  vitestConfigs: { cmd: string; args: string[]; workspace: vscode.WorkspaceFolder }[],
  ctrl: vscode.TestController,
  fileDiscoverer: TestFileDiscoverer,
  context: vscode.ExtensionContext,
) {
  const testWatchers = vitestConfigs.map((vitestConfig, index) =>
    TestWatcher.create(ctrl, fileDiscoverer, vitestConfig, vitestConfig.workspace, index),
  ) ?? []

  statusBarItem = new StatusBarItem()
  effect(() => {
    if (testWatchers.some(watcher => watcher.isRunning.value)) {
      statusBarItem.toRunningMode()
      return
    }
    else if (testWatchers.some(watcher => watcher.isWatching.value)) {
      statusBarItem.toWatchMode(aggregateTestWatcherStatuses(testWatchers))
      return
    }

    statusBarItem.toDefaultMode()
  })

  const stopWatching = () => {
    testWatchers.forEach(watcher => watcher.dispose())
    vscode.workspace
      .getConfiguration('testing')
      .update('automaticallyOpenPeekView', undefined)
  }
  const startWatching = () => {
    testWatchers.forEach(watcher => watcher.watch())
    vscode.workspace
      .getConfiguration('testing')
      .update('automaticallyOpenPeekView', 'never')
  }

  context.subscriptions.push(
    {
      dispose: stopWatching,
    },
    ...testWatchers,
    statusBarItem,
    vscode.commands.registerCommand(Command.StartWatching, startWatching),
    vscode.commands.registerCommand(Command.StopWatching, stopWatching),
    vscode.commands.registerCommand(Command.ToggleWatching, () => {
      const anyWatching = testWatchers.some(watcher => watcher.isWatching.value)
      if (anyWatching)
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

    await Promise.all(testWatchers.map(watcher => watcher.watch()))
    testWatchers.forEach((watcher) => {
      watcher.runTests(gatherTestItemsFromWorkspace(request.include ?? [], watcher.workspace.uri.fsPath))
    })
  }

  return testWatchers
}

function registerRunHandler(
  ctrl: vscode.TestController,
  testWatchers: TestWatcher[],
) {
  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl, testWatchers),
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
