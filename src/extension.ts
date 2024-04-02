import * as vscode from 'vscode'
import { version } from '../package.json'
import { getConfig, testControllerId } from './config'
import type { VitestAPI } from './api'
import { resolveVitestAPI } from './api'
import { TestRunner } from './runner/runner'
import { TestTree } from './testTree'
import { configGlob, workspaceGlob } from './constants'
import { log } from './log'
import { createVitestWorkspaceFile, noop } from './utils'
import { resolveVitestPackages } from './api/pkg'
import type { TestFile } from './testTreeData'
import { getTestData } from './testTreeData'

export async function activate(context: vscode.ExtensionContext) {
  const extension = new VitestExtension()
  context.subscriptions.push(extension)
  await extension.activate()
}

export function deactivate() {}

class VitestExtension {
  private testController: vscode.TestController
  private loadingTestItem: vscode.TestItem

  private runProfiles = new Map<string, vscode.TestRunProfile>()

  private testTree: TestTree
  private api: VitestAPI | undefined

  private disposables: vscode.Disposable[] = []

  constructor() {
    log.info(`[v${version}] Vitest extension is activated because Vitest is installed or there is a Vite/Vitest config file in the workspace.`)

    this.testController = vscode.tests.createTestController(testControllerId, 'Vitest')
    this.testController.refreshHandler = () => this.defineTestProfiles(true).catch(() => {})
    this.testController.resolveHandler = item => this.resolveTestFile(item)
    this.loadingTestItem = this.testController.createTestItem('_resolving', 'Resolving Vitest...')
    this.loadingTestItem.sortText = '.0' // show it first
    this.testTree = new TestTree(this.testController, this.loadingTestItem)
  }

  private async defineTestProfiles(showWarning: boolean) {
    this.testTree.reset([])

    const vitest = await resolveVitestPackages(showWarning)

    if (!vitest.length) {
      log.error('[API]', 'Failed to start Vitest: No vitest config files found')
      this.testController.items.delete(this.loadingTestItem.id)

      await this.api?.dispose()
      return
    }

    const configFiles = vitest.filter(x => x.configFile && !x.workspaceFile)

    if (configFiles.length > 3 && configFiles.every(c => getConfig(c.folder).disableWorkspaceWarning !== true)) {
      vscode.window.showWarningMessage(
        `Vitest found ${configFiles.length} config files. For better performance, consider using a workspace configuration.`,
        'Create vitest.workspace.js',
        'Disable notification',
      ).then((result) => {
        if (result === 'Create vitest.workspace.js')
          createVitestWorkspaceFile(configFiles).catch(noop)

        if (result === 'Disable notification') {
          configFiles.forEach((c) => {
            const rootConfig = vscode.workspace.getConfiguration('vitest', c.folder)
            rootConfig.update('disableWorkspaceWarning', true)
          })
        }
      })
    }

    const folders = new Set(vitest.map(x => x.folder))
    this.testTree.reset(Array.from(folders))

    const previousRunProfiles = this.runProfiles
    this.runProfiles = new Map()

    try {
      await this.api?.dispose()

      this.api = await resolveVitestAPI(showWarning, vitest)

      for (const api of this.api.folderAPIs) {
        await this.testTree.watchTestFilesInWorkspace(
          api,
          await api.getFiles(),
        )
      }
    }
    finally {
      this.testController.items.delete(this.loadingTestItem.id)
    }

    this.api.forEach((api) => {
      const runner = new TestRunner(this.testController, this.testTree, api)

      const prefix = api.prefix
      let runProfile = previousRunProfiles.get(`${api.id}:run`)
      if (!runProfile) {
        runProfile = this.testController.createRunProfile(
          prefix,
          vscode.TestRunProfileKind.Run,
          () => {},
          false,
          undefined,
          true,
        )
      }
      runProfile.tag = api.tag
      runProfile.runHandler = (request, token) => runner.runTests(request, token)
      this.runProfiles.set(`${api.id}:run`, runProfile)
      let debugProfile = previousRunProfiles.get(`${api.id}:debug`)
      if (!debugProfile) {
        debugProfile = this.testController.createRunProfile(
          prefix,
          vscode.TestRunProfileKind.Debug,
          () => {},
          false,
          undefined,
          true,
        )
      }
      debugProfile.tag = api.tag
      debugProfile.runHandler = (request, token) => runner.debugTests(request, token)
      this.runProfiles.set(`${api.id}:debug`, debugProfile)
    })

    for (const [id, profile] of previousRunProfiles) {
      if (!this.runProfiles.has(id))
        profile.dispose()
    }

    // collect tests inside a test file
    vscode.window.visibleTextEditors.forEach(async (editor) => {
      const testItems = this.testTree.getFileTestItems(editor.document.uri)
      const apis = new Set()
      for (const item of testItems) {
        const data = getTestData(item) as TestFile
        if (!apis.has(data.api)) {
          await this.resolveTestFile(item)
          apis.add(data.api)
        }
      }
    })
  }

  private async resolveTestFile(item?: vscode.TestItem) {
    if (!item)
      return
    await this.testTree.discoverFileTests(item)
  }

  async activate() {
    this.loadingTestItem.busy = true
    this.testController.items.replace([this.loadingTestItem])

    this.disposables = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.defineTestProfiles(false)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest.packagePath') || event.affectsConfiguration('vitest.nodeExecutable'))
          this.defineTestProfiles(false)
      }),
      vscode.commands.registerCommand('vitest.openOutput', () => {
        log.openOuput()
      }),
    ]

    // if the config changes, re-define all test profiles
    const configWatchers = [
      vscode.workspace.createFileSystemWatcher(configGlob),
      vscode.workspace.createFileSystemWatcher(workspaceGlob),
    ]
    this.disposables.push(...configWatchers)

    const redefineTestProfiles = (uri: vscode.Uri) => {
      if (uri.fsPath.includes('node_modules'))
        return
      this.defineTestProfiles(false)
    }

    configWatchers.forEach(watcher => watcher.onDidChange(redefineTestProfiles))
    configWatchers.forEach(watcher => watcher.onDidCreate(redefineTestProfiles))
    configWatchers.forEach(watcher => watcher.onDidDelete(redefineTestProfiles))

    try {
      await this.defineTestProfiles(true)
    }
    catch (err) {
      vscode.window.showErrorMessage(
        `There was an error during Vitest startup. Check the output for more details.`,
        'See error',
      ).then((result) => {
        if (result === 'See error')
          vscode.commands.executeCommand('vitest.openOutput')
      })
    }
  }

  async dispose() {
    await this.api?.dispose()
    this.testTree.dispose()
    this.testController.dispose()
    this.runProfiles.forEach(profile => profile.dispose())
    this.disposables.forEach(x => x.dispose())
  }
}
