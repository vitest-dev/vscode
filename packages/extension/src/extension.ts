import type { VitestAPI } from './api'
import type { VitestProcessAPI } from './apiProcess'
import { normalize } from 'pathe'
import * as vscode from 'vscode'
import { version } from '../../../package.json'
import { resolveVitestAPI } from './api'
import { copyErrorOutput, copyTestItemErrors } from './commands/copyErrors'
import { getConfig, testControllerId } from './config'
import { configGlob, workspaceGlob } from './constants'
import { coverageContext } from './coverage'
import { DebugManager, debugTests } from './debug'
import { ExtensionDiagnostic } from './diagnostic'
import { ImportsBreakdownProvider } from './importsBreakdownProvider'
import { InlineConsoleLogManager } from './inlineConsoleLog'
import { log } from './log'
import { RunQueue } from './runQueue'
import { TransformSchemaProvider } from './schemaProvider'
import { resolveVitestPackages } from './spawn/pkg'
import { ExtensionTerminalProcess } from './spawn/terminal'
import { TagsManager } from './tagsManager'
import { TestTree } from './testTree'
import { getTestData, TestFile } from './testTreeData'
import { debounce, showVitestError } from './utils'
import './polyfills'

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

  private runQueues = new Set<RunQueue>()

  private disposables: vscode.Disposable[] = []
  private diagnostic: ExtensionDiagnostic | undefined
  private debugManager: DebugManager
  private schemaProvider: TransformSchemaProvider
  private importsBreakdownProvider: ImportsBreakdownProvider
  private inlineConsoleLog: InlineConsoleLogManager

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
    this.schemaProvider = new TransformSchemaProvider(
      async (apiId, project, environment, file) => {
        const api = this.api?.processes.find(a => a.id === apiId)
        return api?.getTransformedModule(project, environment, file) ?? null
      },
    )
    this.tagsManager = new TagsManager()
    this.testTree = new TestTree(
      this.testController,
      this.loadingTestItem,
      this.tagsManager,
      this.schemaProvider,
    )
    this.debugManager = new DebugManager()
    this.importsBreakdownProvider = new ImportsBreakdownProvider(
      async (moduleId: string) => this.api?.getSourceModuleDiagnostic(moduleId) || {
        modules: [],
        untrackedModules: [],
      },
    )
    this.inlineConsoleLog = new InlineConsoleLogManager(this.testTree)
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
    this.importsBreakdownProvider.clear()
    this.inlineConsoleLog.clear()
    this.testTree.reset([])
    this.runQueues.forEach(q => q.dispose())
    this.runQueues.clear()

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

      this.api = await resolveVitestAPI(workspaces, configs, cancelToken, ({ api: vitest, files }) => {
        this.testTree.watchTestFilesInWorkspace(vitest, files)
        this.setupProcessAPI(vitest, previousRunProfiles)

        this.testController.items.forEach((item) => {
          if (item.children.size) {
            item.busy = false
          }
        })
      })
    }
    catch (err) {
      this.testTree.reset([])
      showVitestError('Failed to start Vitest', err)
      return
    }
    finally {
      this.testController.items.delete(this.loadingTestItem.id)
    }

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

  private setupProcessAPI(vitest: VitestProcessAPI, runProfiles: Map<string, vscode.TestRunProfile>) {
    // Register collection listener so test tree gets notified when tests are collected
    vitest.onCollected((file) => {
      this.testTree.collectFile(vitest, file)
    })

    const prefix = vitest.prefix

    let runProfile = runProfiles.get(`${vitest.id}:run`)
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

    const runQueue = new RunQueue(
      this.testController,
      runProfile,
      this.testTree,
      vitest,
      this.diagnostic,
      this.importsBreakdownProvider,
      this.inlineConsoleLog,
    )
    this.runQueues.add(runQueue)

    runProfile.tag = vitest.tag
    runProfile.runHandler = (request, token) => runQueue.enqueue(request, token, false)
    this.runProfiles.set(`${vitest.id}:run`, runProfile)

    let debugProfile = runProfiles.get(`${vitest.id}:debug`)
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
    debugProfile.tag = vitest.tag
    debugProfile.runHandler = async (request, token) => {
      await this.registerDebugOptions()

      await debugTests(
        this.testController,
        this.testTree,
        vitest.package,
        this.diagnostic,
        this.importsBreakdownProvider,
        this.inlineConsoleLog,

        request,
        token,
        this.debugManager,
      ).catch((error) => {
        vscode.window.showErrorMessage(error.message)
      })
    }
    this.runProfiles.set(`${vitest.id}:debug`, debugProfile)

    let coverageProfile = runProfiles.get(`${vitest.id}:coverage`)
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

    const coverageQueue = new RunQueue(
      this.testController,
      coverageProfile,
      this.testTree,
      vitest,
      this.diagnostic,
      this.importsBreakdownProvider,
      this.inlineConsoleLog,
    )
    this.runQueues.add(coverageQueue)

    coverageProfile.tag = vitest.tag
    coverageProfile.runHandler = (request, token) => coverageQueue.enqueue(request, token, true)
    coverageProfile.loadDetailedCoverage = coverageContext.loadDetailedCoverage
    this.runProfiles.set(`${vitest.id}:coverage`, coverageProfile)
  }

  private async resolveTestFile(item?: vscode.TestItem) {
    if (!item)
      return
    try {
      await this.testTree.discoverTestsInFile(item)
    }
    catch (err) {
      showVitestError('There was an error during test discovery', err)
    }
  }

  async activate() {
    this.diagnostic = getConfig().applyDiagnostic
      ? new ExtensionDiagnostic()
      : undefined

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
      'vitest.cliArguments',
    ]

    this.disposables = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        const configName = reloadConfigNames.find(x => event.affectsConfiguration(x))
        if (configName) {
          this.defineTestProfiles(false).catch((error) => {
            log.error('[API]', `Failed to reload Vitest after "${configName}" has changed`, error)
          })
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.defineTestProfiles(false).catch((error) => {
        log.error('[API]', `Failed to reload Vitest after workspaces changed`, error)
      })),
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
        const apis = this.api?.processes
          .filter(api => api.getPersistentProcessMeta()?.process instanceof ExtensionTerminalProcess)
        if (!apis?.length) {
          vscode.window.showInformationMessage('No shell terminals found. Did you change `vitest.shellType` to `terminal` in the configuration? Do you have any continuous runs active?')
          return
        }
        if (apis.length === 1) {
          log.info('Showing the only available shell terminal');
          (apis[0].getPersistentProcessMeta()?.process as ExtensionTerminalProcess).show()
          return
        }
        const pick = await vscode.window.showQuickPick(
          apis.map((api) => {
            return {
              label: api.prefix,
              process: api.getPersistentProcessMeta()?.process as ExtensionTerminalProcess,
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
      vscode.commands.registerCommand('vitest.openTransformedModule', async (uri: vscode.Uri | undefined) => {
        const currentUri = uri || vscode.window.activeTextEditor?.document.uri
        if (!this.api || !currentUri || currentUri.scheme === 'vitest-transform') {
          return
        }
        const environments = await this.api.getModuleEnvironments(currentUri.fsPath)
        const options = environments.map(({ api, projects }) => {
          return projects.map((project) => {
            return project.environments.map((environment) => {
              let label = ''
              if (environments.length > 1) {
                label += `${api.prefix}: `
              }
              if (project.name) {
                label += `[${project.name}] `
              }
              label += environment
              return {
                label,
                uriParts: [api.id, project.name, environment.name, environment.transformTimestamp],
              }
            })
          })
        }).flat(2)
        if (options.length === 0) {
          vscode.window.showWarningMessage('All module graphs are empty, nothing to show.')
          return
        }
        const pick = options.length === 1 ? options[0] : await vscode.window.showQuickPick(options)
        if (!pick) {
          return
        }
        try {
          const [apiId, projectName, environment, t] = pick.uriParts
          const uri = vscode.Uri.parse(
            `vitest-transform://${currentUri.fsPath}.js?apiId=${apiId}&project=${projectName}&environment=${environment}&t=${t}`,
          )
          const doc = await vscode.workspace.openTextDocument(uri)
          await vscode.window.showTextDocument(doc, { preview: false })
        }
        catch (err) {
          log.error(err)
          vscode.window.showErrorMessage(`Vitest: The file was not processed by Vite yet. Try running the tests first${options.length > 1 ? ' or select a different environment' : ''}.`)
        }
      }),
      vscode.commands.registerCommand('vitest.copyTestItemErrors', testItem => copyTestItemErrors(this.testController, testItem)),
      vscode.commands.registerCommand('vitest.copyErrorOutput', copyErrorOutput),
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
      for (const api of this.api.processes) {
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
    this.testController.dispose()
    this.schemaProvider.dispose()
    this.importsBreakdownProvider.dispose()
    this.inlineConsoleLog.dispose()
    this.runProfiles.forEach(profile => profile.dispose())
    this.runProfiles.clear()
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
    this.runQueues.forEach(q => q.dispose())
    this.runQueues.clear()
  }
}

// TODO: have command to filter configs
// TODO(bug): when _reloading, the continues state stays and can't be removed
// TODO: terminal results are not shown
