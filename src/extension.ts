import * as vscode from 'vscode'
import { testControllerId } from './config'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestPackages } from './api'
import { GlobalTestRunner } from './runner/runner'
import { TestTree } from './testTree'

export async function activate(context: vscode.ExtensionContext) {
  const start = performance.now()
  const meta = await resolveVitestPackages()

  if (!meta.length) {
    // TODO: have a watcher that reruns vitest resolution if workspace folder changes
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
  const api = await resolveVitestAPI(meta).then((api) => {
    const end = performance.now()
    log.info('[API]', `Vitest API resolved in ${end - start}ms`)
    context.subscriptions.push(api)
    return api
  })

  const tree = registerDiscovery(ctrl, api, meta.map(m => m.folder), resolveItem)
  context.subscriptions.push(tree)
  tree.watchTestFilesInWorkspace().catch((e) => {
    log.error('Error while discovering test files', e.stack)
  })

  const runner = new GlobalTestRunner(api, tree, ctrl)
  context.subscriptions.push(runner)

  ctrl.createRunProfile(
    'Run Tests',
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      try {
        await runner.runTests(request, token)
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
      await runner.debugTests(request, token)
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
    vscode.workspace.onDidCloseTextDocument((e) => {
      tree.removeFileTag(e.uri.fsPath, openTestTag)
    }),
    // vscode.workspace.onDidChangeTextDocument(async e =>
    //   (await tree).discoverTestsFromDoc(e.document),
    // ),
    // TODO: update when workspace folder is added/removed
  )
}

function registerDiscovery(
  ctrl: vscode.TestController,
  api: VitestAPI,
  folders: readonly vscode.WorkspaceFolder[],
  loaderItem: vscode.TestItem,
) {
  const fileDiscoverer = new TestTree(api, ctrl, folders, loaderItem)
  // run on refreshing test list
  ctrl.refreshHandler = async () => {
    try {
      await fileDiscoverer.discoverAllTestFiles()
    }
    catch (e) {
      log.error('Error during discovering', e)
    }
  }

  // what if it's called in quick succession?
  // TODO: debounce and queue collects
  ctrl.resolveHandler = async (item) => {
    if (item)
      await fileDiscoverer.discoverFileTests(item)
  }

  // vscode.window.visibleTextEditors.forEach(async x =>
  //   (await fileDiscoverer).discoverTestsFromDoc(x.document),
  // )

  return fileDiscoverer
}

export function deactivate() {}
