import * as vscode from 'vscode'
import { testControllerId } from './config'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestFoldersMeta } from './api'
import { GlobalTestRunner } from './runner/runner'
import { TestTree } from './testTree'

export async function activate(context: vscode.ExtensionContext) {
  const folders = vscode.workspace.workspaceFolders || []

  if (!folders.length) {
    log.info('The Vitest extension is not activated because no workspace folder was detected.')
    return
  }

  const start = performance.now()
  const meta = resolveVitestFoldersMeta(folders)

  if (!meta.length) {
    // Should we wait for the user to install Vitest?
    log.info('The extension is not activated because no Vitest environment was detected.')
    return
  }

  // TODO: when Vitest 1.4.0 is released, we should check for compatibility

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

  const tree = registerDiscovery(ctrl, api, folders, resolveItem).then((discoverer) => {
    context.subscriptions.push(discoverer)
    discoverer.watchTestFilesInWorkspace()
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
      (await tree).removeFileTag(e.uri.fsPath, openTestTag)
    }),
    // vscode.workspace.onDidChangeTextDocument(async e =>
    //   (await tree).discoverTestsFromDoc(e.document),
    // ),
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

  // what if it's called in quick succession?
  // TODO: debounce and queue collects
  ctrl.resolveHandler = async (item) => {
    if (item)
      await (await fileDiscoverer).discoverFileTests(item)
  }

  // vscode.window.visibleTextEditors.forEach(async x =>
  //   (await fileDiscoverer).discoverTestsFromDoc(x.document),
  // )

  return fileDiscoverer
}

export function deactivate() {}
