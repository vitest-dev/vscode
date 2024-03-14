import { sep } from 'node:path'
import * as vscode from 'vscode'
import { basename, dirname } from 'pathe'
import { testControllerId } from './config'
import type { VitestAPI } from './api'
import { resolveVitestAPI, resolveVitestPackages } from './api'
import { TestRunner } from './runner/runner'
import { TestTree } from './testTree'
import { configGlob } from './constants'

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
    this.testController = vscode.tests.createTestController(testControllerId, 'Vitest')
    this.testController.refreshHandler = () => this.defineTestProfiles().catch(() => {})
    this.testController.resolveHandler = item => this.resolveTest(item)
    this.loadingTestItem = this.testController.createTestItem('_resolving', 'Resolving Vitest...')
    this.testTree = new TestTree(this.testController, this.loadingTestItem)
  }

  private async defineTestProfiles() {
    await this.api?.dispose()

    const vitest = await resolveVitestPackages()
    this.testTree.reset(vitest.map(x => x.folder))

    this.api = await resolveVitestAPI(this.testTree, vitest)

    const previousRunProfiles = this.runProfiles
    this.runProfiles = new Map()

    await this.testTree.discoverAllTestFiles(
      await this.api.getFiles(),
    )

    this.api.forEach((api) => {
      const runner = new TestRunner(this.testController, this.testTree, api)

      const configFile = basename(api.configFile)
      const folderName = basename(dirname(api.configFile))

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
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.defineTestProfiles()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest'))
          this.defineTestProfiles()
      }),
    ]

    // if the config changes, re-define all test profiles
    const configWatcher = vscode.workspace.createFileSystemWatcher(configGlob)
    this.disposables.push(configWatcher)

    const redefineTestProfiles = (uri: vscode.Uri) => {
      if (uri.fsPath.includes('node_modules'))
        return
      this.defineTestProfiles()
    }

    configWatcher.onDidChange(redefineTestProfiles)
    configWatcher.onDidCreate(redefineTestProfiles)
    configWatcher.onDidDelete(redefineTestProfiles)

    await this.defineTestProfiles()
  }

  async dispose() {
    await this.api?.dispose()
    this.testTree.dispose()
    this.testController.dispose()
    this.runProfiles.forEach(profile => profile.dispose())
    this.disposables.forEach(x => x.dispose())
  }
}
