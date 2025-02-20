import * as vscode from 'vscode'
import './polyfills'
import { normalize } from 'pathe'
import { version } from '../package.json'
import { getConfig, testControllerId } from './config'
import type { VitestAPI } from './api'
import { resolveVitestAPI } from './api'
import { TestRunner } from './runner'
import { TestTree } from './testTree'
import { configGlob, workspaceGlob } from './constants'
import { log } from './log'
import { debounce, showVitestError } from './utils'
import { resolveVitestPackages } from './api/pkg'
import { TestFile, getTestData } from './testTreeData'
import { TagsManager } from './tagsManager'
import { coverageContext } from './coverage'
import { ExtensionTerminalProcess } from './api/terminal'
import { debugTests } from './debug'

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
  private tagsManager: TagsManager
  private api: VitestAPI | undefined

  private runners: TestRunner[] = []

  private disposables: vscode.Disposable[] = []

  /** @internal */
  _debugDisposable: vscode.Disposable | undefined

  constructor() {
    log.info(`[v${version}] Vitest extension is activated because Vitest is installed or there is a Vite/Vitest config file in the workspace.`)

    this.testController = vscode.tests.createTestController(testControllerId, 'Vitest')
    this.testController.refreshHandler = cancelToken => this.defineTestProfiles(true, cancelToken).catch((err) => {
      showVitestError('Failed to refresh Vitest', err)
    })
    this.testController.resolveHandler = item => this.resolveTestFile(item)
    this.loadingTestItem = this.testController.createTestItem('_resolving', 'Resolving Vitest...')
    this.loadingTestItem.sortText = '.0' // show it first
    this.testTree = new TestTree(this.testController, this.loadingTestItem)
    this.tagsManager = new TagsManager(this.testTree)
  }

  private _defineTestProfilePromise: Promise<void> | undefined

  private async defineTestProfiles(showWarning: boolean, cancelToken?: vscode.CancellationToken) {
    if (!this._defineTestProfilePromise) {
      this._defineTestProfilePromise = (() => this._defineTestProfiles(showWarning, cancelToken))().finally(() => {
        this._defineTestProfilePromise = undefined
      })
    }
    return await this._defineTestProfilePromise
  }

  private async _defineTestProfiles(showWarning: boolean, cancelToken?: vscode.CancellationToken) {
    this.testTree.reset([])
    this.runners.forEach(runner => runner.dispose())
    this.runners = []

    const { workspaces, configs } = await resolveVitestPackages(showWarning)

    if (cancelToken?.isCancellationRequested) {
      return
    }

    if (!workspaces.length && !configs.length) {
      log.error('[API]', 'Failed to start Vitest: No vitest config files found')
      this.testController.items.delete(this.loadingTestItem.id)

      await this.api?.dispose()
      return
    }

    const folders = new Set([...workspaces, ...configs].map(x => x.folder))
    this.testTree.reset(Array.from(folders))

    const previousRunProfiles = this.runProfiles
    this.runProfiles = new Map()

    try {
      await this.api?.dispose()

      if (cancelToken?.isCancellationRequested) {
        return
      }

      this.api = await resolveVitestAPI(workspaces, configs)

      this.api.onUnexpectedExit((code) => {
        if (code) {
          showVitestError('Vitest process exited unexpectedly')
          this.testTree.reset([])
          this.testController.items.delete(this.loadingTestItem.id)
          this.api?.dispose()
          this.api = undefined
        }
        else {
          log.info('[API] Reloading API due to unexpected empty exit code.')
          this.api?.dispose()
          this.api = undefined
          this.defineTestProfiles(false).catch((err) => {
            log.error('[API]', 'Failed to refresh Vitest', err)
          })
        }
      })

      for (const api of this.api.folderAPIs) {
        const files = await api.getFiles()
        await this.testTree.watchTestFilesInWorkspace(
          api,
          files,
        )
      }
    }
    finally {
      this.testController.items.delete(this.loadingTestItem.id)
    }

    this.api.forEach((api) => {
      const runner = new TestRunner(
        this.testController,
        this.testTree,
        api,
      )
      this.runners.push(runner)

      const prefix = api.prefix
      let runProfile = previousRunProfiles.get(`${api.id}:run`)
      if (!runProfile) {
        runProfile = this.testController.createRunProfile(
          prefix,
          vscode.TestRunProfileKind.Run,
          () => {
            log.error('Run handler is not defined')
          },
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
          () => {
            log.error('Run handler is not defined')
          },
          false,
          undefined,
          false, // continues debugging is not supported
        )
      }
      debugProfile.tag = api.tag
      debugProfile.runHandler = async (request, token) => {
        await this.registerDebugOptions()

        await debugTests(
          this.testController,
          this.testTree,
          api.package,

          request,
          token,
        )
      }
      this.runProfiles.set(`${api.id}:debug`, debugProfile)

      // coverage is supported since VS Code 1.88
      // @ts-expect-error check for 1.88
      if (vscode.TestRunProfileKind.Coverage && 'FileCoverage' in vscode) {
        let coverageProfile = previousRunProfiles.get(`${api.id}:coverage`)
        if (!coverageProfile) {
          coverageProfile = this.testController.createRunProfile(
            prefix,
            vscode.TestRunProfileKind.Coverage,
            () => {
              log.error('Run handler is not defined')
            },
            false,
            undefined,
            true,
          )
        }
        coverageProfile.tag = api.tag
        coverageProfile.runHandler = (request, token) => runner.runCoverage(request, token)
        coverageProfile.loadDetailedCoverage = coverageContext.loadDetailedCoverage
        this.runProfiles.set(`${api.id}:coverage`, coverageProfile)
      }
    })

    for (const [id, profile] of previousRunProfiles) {
      if (!this.runProfiles.has(id))
        profile.dispose()
    }

    // collect tests inside a test file
    vscode.window.visibleTextEditors.forEach(async (editor) => {
      const testItems = this.testTree.getFileTestItems(editor.document.uri.fsPath)
      const promises = []
      for (const item of testItems) {
        const data = getTestData(item) as TestFile
        if (data instanceof TestFile) {
          promises.push(this.resolveTestFile(item))
        }
      }
      await Promise.all(promises).catch((err) => {
        log.error('Failed to collect tests from visible text editors', err)
      })
    })
  }

  private async resolveTestFile(item?: vscode.TestItem) {
    if (!item)
      return
    try {
      await this.testTree.discoverFileTests(item)
    }
    catch (err) {
      showVitestError('There was an error during test discovery', err)
    }
  }

  async activate() {
    this.loadingTestItem.busy = true
    this.testController.items.replace([this.loadingTestItem])

    const reloadConfigNames = [
      'vitest.vitestPackagePath',
      'vitest.nodeExecutable',
      'vitest.nodeExecArgs',
      'vitest.workspaceConfig',
      'vitest.rootConfig',
      'vitest.shellType',
      'vitest.terminalShellArgs',
      'vitest.terminalShellPath',
      'vitest.filesWatcherInclude',
      'vitest.experimentalStaticAstCollect',
      'vitest.cliArguments',
    ]

    this.disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (reloadConfigNames.some(x => event.affectsConfiguration(x)))
          this.defineTestProfiles(false)
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.defineTestProfiles(false)),
      vscode.commands.registerCommand('vitest.openOutput', () => {
        log.openOuput()
      }),
      vscode.commands.registerCommand('vitest.revealInTestExplorer', async (uri: vscode.Uri | undefined) => {
        if (uri === undefined) {
          uri = vscode.window.activeTextEditor?.document.uri
        }
        if (!(uri instanceof vscode.Uri)) {
          return
        }
        const testItems = this.testTree.getFileTestItems(uri.fsPath)
        if (testItems[0]) {
          vscode.commands.executeCommand('vscode.revealTestInExplorer', testItems[0])
        }
      }),
      vscode.commands.registerCommand('vitest.showShellTerminal', async () => {
        const apis = this.api?.folderAPIs
          .filter(api => api.process instanceof ExtensionTerminalProcess)
        if (!apis?.length) {
          vscode.window.showInformationMessage('No shell terminals found. Did you change `vitest.shellType` to `terminal` in the configuration?')
          return
        }
        if (apis.length === 1) {
          log.info('Showing the only available shell terminal');
          (apis[0].process as ExtensionTerminalProcess).show()
          return
        }
        const pick = await vscode.window.showQuickPick(
          apis.map((api) => {
            return {
              label: api.prefix,
              process: api.process as ExtensionTerminalProcess,
            }
          }),
        )
        if (pick) {
          log.info('Showing picked shell terminal:', pick.label)
          pick.process.show()
        }
      }),
      vscode.commands.registerCommand('vitest.updateSnapshot', async (testItem: vscode.TestItem | undefined) => {
        if (!testItem)
          return
        const api = this.testTree.getAPIFromTestItem(testItem)
        if (!api)
          return
        const profile = this.runProfiles.get(`${api.id}:run`)
        if (!profile)
          return
        const request = new vscode.TestRunRequest(
          [testItem],
          undefined,
          profile,
          false,
        )
        Object.assign(request, { updateSnapshots: true })
        const tokenSource = new vscode.CancellationTokenSource()
        await profile.runHandler(request, tokenSource.token)
      }),
    ]

    // if the config changes, re-define all test profiles
    const configWatchers = [
      vscode.workspace.createFileSystemWatcher(configGlob),
      vscode.workspace.createFileSystemWatcher(workspaceGlob),
    ]
    this.disposables.push(...configWatchers)

    const redefineTestProfiles = debounce((uri: vscode.Uri, event: 'create' | 'delete' | 'change') => {
      if (!this.api || uri.fsPath.includes('node_modules') || uri.fsPath.includes('.timestamp-'))
        return
      // if new config is created, always check if it should be respected
      if (event === 'create') {
        this.defineTestProfiles(false).catch((err) => {
          log.error('Failed to define test profiles after a new config file was created', err)
        })
        return
      }
      // otherwise ignore changes to unrelated configs
      const filePath = normalize(uri.fsPath)
      for (const api of this.api.folderAPIs) {
        if (
          api.package.workspaceFile === filePath
          || api.configs.includes(filePath)
        ) {
          this.defineTestProfiles(false).catch((err) => {
            log.error('Failed to define test profiles after a new config file was updated', err)
          })
          return
        }
      }
    }, 300)

    configWatchers.forEach(watcher => watcher.onDidChange(uri => redefineTestProfiles(uri, 'change')))
    configWatchers.forEach(watcher => watcher.onDidCreate(uri => redefineTestProfiles(uri, 'create')))
    configWatchers.forEach(watcher => watcher.onDidDelete(uri => redefineTestProfiles(uri, 'delete')))

    try {
      await this.defineTestProfiles(true)

      this.tagsManager.activate()
    }
    catch (err) {
      showVitestError('There was an error during Vitest startup', err)
    }
  }

  async registerDebugOptions() {
    if (this._debugDisposable) {
      return
    }
    const config = getConfig()
    if (config.shellType !== 'terminal') {
      return
    }
    try {
      const jsDebugExt = vscode.extensions.getExtension('ms-vscode.js-debug-nightly') || vscode.extensions.getExtension('ms-vscode.js-debug')
      await jsDebugExt?.activate()
      const jsDebug: import('@vscode/js-debug').IExports = jsDebugExt?.exports

      if (jsDebug) {
        this._debugDisposable = jsDebug.registerDebugTerminalOptionsProvider({
          provideTerminalOptions(options) {
            options.shellArgs = getConfig().terminalShellArgs
            options.shellPath = getConfig().terminalShellPath
            return options
          },
        })
        this.disposables.push(this._debugDisposable)
      }
      else {
        log.error('Failed to connect to the debug extension. Debugger will open a terminal window.')
      }
    }
    catch (err) {
      log.error('Cannot create debug options provider.', err)
    }
  }

  async dispose() {
    this.api?.dispose()
    this.testTree.dispose()
    this.tagsManager.dispose()
    this.testController.dispose()
    this.runProfiles.forEach(profile => profile.dispose())
    this.runProfiles.clear()
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
    this.runners.forEach(runner => runner.dispose())
    this.runners = []
  }
}
