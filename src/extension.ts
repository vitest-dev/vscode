import { sep } from 'node:path'
import * as vscode from 'vscode'
import { basename, dirname } from 'pathe'
import { testControllerId } from './config'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestPackages } from './api'
import { TestRunner } from './runner/runner'
import { TestTree } from './testTree'
import { configGlob, workspaceGlob } from './constants'
import { log } from './log'

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
    log.info('[Vitest] Extension is activated because Vitest is installed or there is a Vite/Vitest config file in the workspace.')

    this.testController = vscode.tests.createTestController(testControllerId, 'Vitest')
    this.testController.refreshHandler = () => this.defineTestProfiles(true).catch(() => {})
    this.testController.resolveHandler = item => this.resolveTest(item)
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

    const folders = new Set(vitest.map(x => x.folder))
    this.testTree.reset(Array.from(folders))

    const previousRunProfiles = this.runProfiles
    this.runProfiles = new Map()

    try {
      await this.api?.dispose()

      this.api = await resolveVitestAPI(this.testTree, vitest)

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

      const configFile = basename(api.id)
      const folderName = basename(dirname(api.id))

      const prefix = `${folderName}${sep}${configFile}`
      let runProfile = previousRunProfiles.get(`${prefix}:run`)
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
      runProfile.runHandler = (request, token) => runner.runTests(request, token)
      this.runProfiles.set(`${prefix}:run`, runProfile)
      let debugProfile = previousRunProfiles.get(`${prefix}:debug`)
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
      debugProfile.runHandler = (request, token) => runner.debugTests(request, token)
      this.runProfiles.set(`${prefix}:debug`, debugProfile)
    })

    for (const [id, profile] of previousRunProfiles) {
      if (!this.runProfiles.has(id))
        profile.dispose()
    }
  }

  private async resolveTest(item?: vscode.TestItem) {
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
        if (event.affectsConfiguration('vitest'))
          this.defineTestProfiles(false)
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

    await this.defineTestProfiles(true)
  }

  async dispose() {
    await this.api?.dispose()
    this.testTree.dispose()
    this.testController.dispose()
    this.runProfiles.forEach(profile => profile.dispose())
    this.disposables.forEach(x => x.dispose())
  }
}
