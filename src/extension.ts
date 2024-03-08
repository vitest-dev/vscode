import path from 'node:path'
import * as vscode from 'vscode'
import { effect } from '@vue/reactivity'
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'
import type { ResolvedConfig } from 'vitest'
import { StatusBarItem } from './StatusBarItem'
import { TestFile, WEAKMAP_TEST_DATA } from './TestData'
import { Command } from './command'
import {
  detectVitestEnvironmentFolders,
  getConfig,
  getVitestWorkspaceConfigs,
  testControllerId,
  vitestEnvironmentFolders,
} from './config'
import { TestFileDiscoverer } from './discover'
import { log } from './log'
import {
  debugHandler,
  gatherTestItemsFromWorkspace,
  runHandler,
  updateSnapshot,
} from './runHandler'
import { TestWatcher } from './watch'

import type { VitestWorkspaceConfig } from './config'
import { fetchVitestConfig } from './pure/watch/vitestConfig'
import { openTestTag } from './tags'

let client: LanguageClient
export async function activate(context: vscode.ExtensionContext) {
  await detectVitestEnvironmentFolders()
  if (vitestEnvironmentFolders.length === 0) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

  const ctrl = vscode.tests.createTestController(testControllerId, 'Vitest')

  const workspaceConfigs = await getVitestWorkspaceConfigs()
  // enable run/debug/watch tests only if vitest version >= 0.12.0
  if (!workspacesCompatibilityCheck(workspaceConfigs)) {
    const msg = 'Because Vitest version < 0.12.0 for every workspace folder, run/debug/watch tests from Vitest extension disabled.\n'
    log.error(msg)
    // if the vitest detection is false positive, we may still reach here.
    // but we can still use `.version` to filter some false positive
    if (workspaceConfigs.some(x => x.isUsingVitestForSure))
      vscode.window.showWarningMessage(msg)

    context.subscriptions.push(
      vscode.commands.registerCommand(Command.UpdateSnapshot, () => {
        vscode.window.showWarningMessage(msg)
      }),
    )

    return
  }

  const config = await fetchVitestConfig(workspaceConfigs)
  if (!config) {
    vscode.window.showWarningMessage('Cannot run tests: no Vitest config found.')
    return
  }
  const fileDiscoverer = registerDiscovery(ctrl, context, config)
  registerRunDebugWatchHandler(ctrl, workspaceConfigs, fileDiscoverer, context)
  context.subscriptions.push(
    ctrl,
    fileDiscoverer,
    vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
      updateSnapshot(ctrl, fileDiscoverer, test)
    }),
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
  // start the language server
  await activateLanguageClient(context)
}

function workspacesCompatibilityCheck(workspaceConfigs: VitestWorkspaceConfig[]) {
  workspaceConfigs.forEach((vitest) => {
    log.info(`Vitest Workspace [${vitest.workspace.name}]: Vitest version = ${vitest.version}`)
  })

  // prompt error message if we can get the version from vitest, but it's not compatible with the extension
  workspaceConfigs.filter(x => !x.isCompatible && x.isUsingVitestForSure).forEach((config) => {
    vscode.window.showWarningMessage('Because Vitest version < 0.12.0'
    + `, run/debug/watch tests are disabled in workspace "${config.workspace.name}" \n`)
  })

  if (workspaceConfigs.every(x => !x.isCompatible))
    return false

  return true
}

function registerDiscovery(ctrl: vscode.TestController, context: vscode.ExtensionContext, config: ResolvedConfig) {
  const fileDiscoverer = new TestFileDiscoverer(config)
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
  const testWatchers = vitestConfigs.map((vitestConfig, index) => {
    const watcher = TestWatcher.create(ctrl, fileDiscoverer, vitestConfig, vitestConfig.workspace, index)

    if (getConfig(vitestConfig.workspace).watchOnStartup)
      watcher.watch()

    return watcher
  }) ?? []

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
  }

  context.subscriptions.push(
    {
      dispose: stopWatching,
    },
    ...testWatchers,
    statusBarItem,
  )

  ctrl.createRunProfile(
    'Run Tests (Watch Mode)',
    vscode.TestRunProfileKind.Run,
    runHandler,
    false,
    undefined,
    true,
  )

  async function runHandler(
    request: vscode.TestRunRequest,
    cancellation: vscode.CancellationToken,
  ) {
    if (
      vscode.workspace.workspaceFolders === undefined
      || vscode.workspace.workspaceFolders.length === 0
    )
      return

    cancellation.onCancellationRequested(() => {
      testWatchers.forEach(watcher => watcher.dispose())
    })

    await Promise.all(testWatchers.map(watcher => watcher.watch()))
    testWatchers.forEach((watcher) => {
      watcher.runTests(gatherTestItemsFromWorkspace(request.include ?? [], watcher.workspace.uri.fsPath))
    })
  }

  return testWatchers
}

function registerRunDebugWatchHandler(
  ctrl: vscode.TestController,
  workspaceConfigs: VitestWorkspaceConfig[],
  fileDiscoverer: TestFileDiscoverer,
  context: vscode.ExtensionContext,
) {
  const testWatchers = registerWatchHandlers(
    workspaceConfigs.filter(x => x.isCompatible && !x.isDisabled),
    ctrl,
    fileDiscoverer,
    context,
  ) ?? []

  const workspaces = workspaceConfigs.filter(x => x.isCompatible && !x.isDisabled).map(x => x.workspace)
  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl, fileDiscoverer, testWatchers, workspaces),
    true,
  )

  ctrl.createRunProfile(
    'Debug Tests',
    vscode.TestRunProfileKind.Debug,
    debugHandler.bind(null, ctrl, fileDiscoverer, workspaces),
    true,
  )
}

async function activateLanguageClient(context: vscode.ExtensionContext) {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join('dist', 'languageServer.js'))
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] }

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  }

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: 'file', language: 'typescript' }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc'),
    },
  }

  // Create the language client and start the client.
  client = new LanguageClient(
    'vitestLanguageServer',
    'Vitest Language Server',
    serverOptions,
    clientOptions,
  )

  // Start the client. This will also launch the server
  await client.start()
  log.info('LSP client started')
}

export function deactivate() {
  client?.stop()
}
