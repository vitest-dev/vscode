import * as vscode from 'vscode'
import { testControllerId } from './config'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestFoldersMeta } from './api'
import { GlobalTestRunner } from './runner/runner'
import { TestTree } from './testTree'

// TODO: more error handling for lazy loaded API
export async function activate(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders || []

  if (!folders.length) {
    log.info('The Vitest extension is not activated because no workspace folder was detected.')
    return
  }

  const start = performance.now()
  const meta = resolveVitestFoldersMeta(folders)

  if (!meta.length) {
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

  // we know Vitest is installed, so we can create a test controller
  const ctrl = vscode.tests.createTestController(testControllerId, 'Vitest')

  const resolveItem = ctrl.createTestItem('_resolving', 'Resolving Vitest...')
  resolveItem.busy = true
  ctrl.items.add(resolveItem)

  context.subscriptions.push(ctrl)

  // start discover spinner as soon as possible, so we await it only when accessed
  const api = resolveVitestAPI(meta).then((api) => {
    const end = performance.now()
    log.info('[API]', `Vitest API resolved in ${end - start}ms`)
    context.subscriptions.push(api)
    return api
  })

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

  const tree = registerDiscovery(ctrl, api, folders, resolveItem).then((discoverer) => {
    context.subscriptions.push(discoverer)
    discoverer.discoverAllTestFiles()
    return discoverer
  })
  const runner = (async () => new GlobalTestRunner(await api, await tree, ctrl))().then((runner) => {
    context.subscriptions.push(runner)
    return runner
  })

  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      try {
        await (await runner).runTests(request, token)
      }
      catch (e: any) {
        if (!e.message.includes('timeout on calling'))
          log.error('Error while running tests', e)
      }
    },
    true,
    undefined,
    true,
  )

  ctrl.createRunProfile(
    'Debug Tests',
    vscode.TestRunProfileKind.Debug,
    async (request, token) => {
      await (await runner).debugTests(request, token)
    },
    false,
    undefined,
    true,
  )

  context.subscriptions.push(
    ctrl,
    // vscode.commands.registerCommand(Command.UpdateSnapshot, (test) => {
    //   updateSnapshot(ctrl, fileDiscoverer, test)
    // }),
    vscode.workspace.onDidCloseTextDocument(async (e) => {
      const item = await (await tree).discoverTestsFromDoc(e)
      if (item)
        item.tags = item.tags.filter(x => x !== openTestTag)
    }),
    vscode.workspace.onDidChangeTextDocument(async e =>
      (await tree).discoverTestsFromDoc(e.document),
    ),
    // TODO: update when workspace folder is added/removed
  )

  await api
}

function registerDiscovery(
  ctrl: vscode.TestController,
  api: Promise<VitestAPI>,
  folders: readonly vscode.WorkspaceFolder[],
  loaderItem: vscode.TestItem,
) {
  const fileDiscoverer = (async () => new TestTree(await api, ctrl, folders, loaderItem))()
  // run on refreshing test list
  ctrl.refreshHandler = async () => {
    await (await fileDiscoverer).discoverAllTestFiles()
  }

  // what is it's called in quick succession?
  // TODO: debounce and queue collects
  ctrl.resolveHandler = async (item) => {
    if (!item) {
      // item == null, when user opened the testing panel
      // in this case, we should discover and watch all the testing files
      await (await fileDiscoverer).watchTestFilesInWorkspace()
    }
    else {
      await (await fileDiscoverer).discoverFileTests(item)
    }
  }

  vscode.window.visibleTextEditors.forEach(async x =>
    (await fileDiscoverer).discoverTestsFromDoc(x.document),
  )

  return fileDiscoverer
}

// export function deactivate() {}
