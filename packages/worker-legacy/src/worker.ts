import type {
  ExtensionTestFileSpecification,
  ExtensionTestSpecification,
  ExtensionWorkerTransport,
} from 'vitest-vscode-shared'
import type {
  Reporter,
  ResolvedConfig,
  TestSpecification,
  Vitest as VitestCore,
  WorkspaceProject,
} from 'vitest/node'
import type { WorkerWSEventEmitter } from '../../shared/src/emitter'
import EventEmitter from 'node:events'
import { readFileSync } from 'node:fs'
import mm from 'micromatch'
import { relative } from 'pathe'
import { assert, limitConcurrency } from '../../shared/src/utils'
import { astCollectTests, createFailedFileTask } from './collect'
import { ExtensionCoverageManager } from './coverage'
import { ExtensionWorkerWatcher } from './watcher'

type ArgumentsType<T> = T extends (...args: infer U) => any ? U : never

export class ExtensionWorker implements ExtensionWorkerTransport {
  private readonly watcher: ExtensionWorkerWatcher
  private readonly coverage: ExtensionCoverageManager

  public static emitter = new EventEmitter()

  public static COLLECT_NAME_PATTERN = '$a'

  constructor(
    public readonly vitest: VitestCore,
    private readonly debug = false,
    public readonly alwaysAstCollect = false,
    private emitter: WorkerWSEventEmitter,
    finalCoverageFileName: string,
  ) {
    this.watcher = new ExtensionWorkerWatcher(this)
    this.coverage = new ExtensionCoverageManager(this, finalCoverageFileName)
  }

  public get collecting() {
    return this.configOverride.testNamePattern?.toString() === `/${ExtensionWorker.COLLECT_NAME_PATTERN}/`
  }

  private get configOverride(): Partial<ResolvedConfig> {
    return (this.vitest as any).configOverride
  }

  public setGlobalTestNamePattern(pattern?: string | RegExp): void {
    if (pattern == null || pattern === '') {
      this.configOverride.testNamePattern = undefined
    }
    else if ('setGlobalTestNamePattern' in this.vitest) {
      return this.vitest.setGlobalTestNamePattern(pattern)
    }
    else {
      this.configOverride.testNamePattern = typeof pattern === 'string'
        ? new RegExp(pattern)
        : pattern
    }
  }

  public getRootTestProject(): WorkspaceProject {
    // vitest 3 uses getRootProject
    if ('getRootProject' in this.vitest) {
      return this.vitest.getRootProject()
    }
    // vitest 3.beta uses getRootTestProject
    if ('getRootTestProject' in this.vitest) {
      return ((this.vitest as any).getRootTestProject as () => WorkspaceProject)()
    }
    return (this.vitest as any).getCoreWorkspaceProject()
  }

  public async collectTests(files: [projectName: string, filepath: string][]) {
    const astCollect: [project: WorkspaceProject, filepath: string][] = []
    const otherTests: [project: WorkspaceProject, filepath: string][] = []

    for (const [projectName, filepath] of files) {
      const project = this.vitest.projects.find(project => project.getName() === projectName)
      assert(project, `Project ${projectName} not found for file ${filepath}`)
      if (this.alwaysAstCollect || project.config.browser.enabled) {
        astCollect.push([project, filepath])
      }
      else {
        otherTests.push([project, filepath])
      }
    }

    await Promise.all([
      (async () => {
        if (astCollect.length) {
          await this.astCollect(astCollect)
        }
      })(),
      (async () => {
        if (otherTests.length) {
          const files = otherTests.map<ExtensionTestSpecification>(
            ([project, filepath]) => [
              project.getName(),
              filepath,
            ] as const,
          )

          try {
            await this.runTestFiles(files, ExtensionWorker.COLLECT_NAME_PATTERN)
          }
          finally {
            this.setTestNamePattern(undefined)
          }
        }
      })(),
    ])
  }

  public async astCollect(specs: [project: WorkspaceProject, file: string][]) {
    if (!specs.length) {
      return
    }

    const runConcurrently = limitConcurrency(5)

    const promises = specs.map(([project, filename]) => runConcurrently(
      () => astCollectTests(project, filename).catch(err => createFailedFileTask(project, filename, err)),
    ))
    const files = await Promise.all(promises)
    this.configOverride.testNamePattern = new RegExp(ExtensionWorker.COLLECT_NAME_PATTERN)
    await this.report('onCollected', files)
    this.setTestNamePattern(undefined)
  }

  public async updateSnapshots(files?: ExtensionTestSpecification[] | string[] | undefined, testNamePattern?: string | undefined) {
    this.configOverride.snapshotOptions = {
      updateSnapshot: 'all',
      // environment is resolved inside a worker thread
      snapshotEnvironment: null as any,
    }
    try {
      return await this.runTests(files, testNamePattern)
    }
    finally {
      delete this.configOverride.snapshotOptions
    }
  }

  async resolveTestSpecs(specs: string[] | ExtensionTestSpecification[] | undefined): Promise<ExtensionTestSpecification[]> {
    if (!specs || typeof specs[0] === 'string') {
      const files = await this.globTestSpecifications(specs as string[] | undefined)
      return files.map<ExtensionTestSpecification>((spec) => {
        const project = spec[0]
        const file = spec[1]

        return [
          project.getName(),
          file,
        ]
      })
    }
    return (specs as ExtensionTestSpecification[] || [])
  }

  public async runTests(specsOrPaths: ExtensionTestSpecification[] | string[] | undefined, testNamePattern?: string) {
    // @ts-expect-error private method in Vitest <=2.1.5
    await this.vitest.initBrowserProviders?.()

    const specs = await this.resolveTestSpecs(specsOrPaths)

    await this.runTestFiles(specs, testNamePattern, !specsOrPaths)

    // debugger never runs in watch mode
    if (this.debug) {
      await this.vitest.close()
      this.emitter.close()
    }
  }

  public cancelRun() {
    return this.vitest.cancelCurrentRun('keyboard-input')
  }

  public async getFiles(): Promise<ExtensionTestFileSpecification[]> {
    // reset cached test files list
    this.vitest.projects.forEach((project) => {
      // testFilesList is private
      (project as any).testFilesList = null
    })
    const files = await this.globTestSpecifications()
    return files.map((spec) => {
      const config = spec[0].config
      return [
        spec[1],
        {
          project: config.name || '',
          pool: config.pool,
          browser: config.browser?.enabled
            ? {
                provider: config.browser.provider || 'preview',
                name: config.browser.name,
              }
            : undefined,
        },
      ]
    })
  }

  private async globTestSpecifications(filters?: string[]): Promise<TestSpecification[]> {
    if ('globTestSpecifications' in this.vitest) {
      return this.vitest.globTestSpecifications(filters)
    }
    return await (this.vitest as any).globTestFiles(filters)
  }

  private invalidateTree(mod: any, seen = new Set()) {
    if (seen.has(mod)) {
      return
    }
    seen.add(mod)
    this.vitest.server.moduleGraph.invalidateModule(mod)
    mod.clientImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
    mod.ssrImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
  }

  private async runTestFiles(specs: ExtensionTestSpecification[], testNamePattern?: string | undefined, runAllFiles = false) {
    await (this.vitest as any).runningPromise
    this.watcher.markRerun(false)

    this.setTestNamePattern(testNamePattern)

    // populate cache so it can find test files
    if (this.debug)
      await this.globTestSpecifications(specs.map(f => f[1]))

    await this.rerunTests(specs, runAllFiles)
  }

  private setTestNamePattern(pattern: string | undefined) {
    this.configOverride.testNamePattern = pattern ? new RegExp(pattern) : undefined
  }

  private async rerunTests(specs: ExtensionTestSpecification[], runAllFiles = false) {
    const paths = specs.map(spec => spec[1])

    const specsToRun = specs.flatMap((spec) => {
      const file = typeof spec === 'string' ? spec : spec[1]
      const fileSpecs = this.vitest.getModuleSpecifications
        ? this.vitest.getModuleSpecifications(file)
        // supported by the older version
        : this.vitest.getProjectsByTestFile(file)
      if (!fileSpecs.length) {
        return []
      }
      return fileSpecs.filter(s => s[0].getName() === spec[0])
    })
    await Promise.all([
      this.report('onWatcherRerun', paths),
      // `_onUserTestsRerun` exists only in Vitest 3 and it's private
      // the extension needs to migrate to the new API
      ...((this.vitest as any)._onUserTestsRerun || []).map((fn: any) => fn(specs)),
    ])

    await this.runFiles(specsToRun, runAllFiles)

    await this.report('onWatcherStart', this.vitest.state.getFiles(paths))
  }

  private handleFileChanged(file: string): string[] {
    const ctx = this.vitest as any
    // support Vitest 3
    if (ctx.watcher) {
      return ctx.watcher.handleFileChanged(file) ? [file] : []
    }
    return ctx.handleFileChanged(file)
  }

  private async runFiles(specs: TestSpecification[], runAllFiles: boolean) {
    await (this.vitest as any).runFiles(specs, runAllFiles)
  }

  private scheduleRerun(files: string[]): Promise<void> {
    return (this.vitest as any).scheduleRerun(files)
  }

  private updateLastChanged(filepath: string) {
    this.vitest.projects.forEach(({ server, browser }) => {
      const serverMods = server.moduleGraph.getModulesByFile(filepath)
      serverMods?.forEach(mod => server.moduleGraph.invalidateModule(mod))
      if (browser) {
        const browserMods = browser.vite.moduleGraph.getModulesByFile(filepath)
        browserMods?.forEach(mod => browser.vite.moduleGraph.invalidateModule(mod))
      }
    })
  }

  onFilesChanged(files: string[]) {
    try {
      for (const file of files) {
        this.updateLastChanged(file)
        const needRerun = this.handleFileChanged(file)
        if (needRerun.length) {
          this.scheduleRerun(needRerun)
        }
      }
    }
    catch (err) {
      this.vitest.logger.error('Error during analyzing changed files', err)
    }
  }

  async onFilesCreated(files: string[]) {
    try {
      const testFiles: string[] = []

      for (const file of files) {
        this.updateLastChanged(file)
        let content: string | null = null
        const projects = []
        for (const project of this.vitest.projects) {
          if (this.isTestFile(
            project,
            file,
            () => content ?? (content = readFileSync(file, 'utf-8')),
          )) {
            testFiles.push(file)
            ;(project as any).testFilesList?.push(file)
            this.vitest.changedTests.add(file)
            projects.push(project)
          }
        }
        // to support Vitest 1.4.0
        if (projects.length && (this.vitest as any).projectsTestFiles) {
          (this.vitest as any).projectsTestFiles.set(file, new Set(projects))
        }
      }

      testFiles.forEach(file => this.scheduleRerun([file]))
    }
    catch (err) {
      this.vitest.logger.error('Error during analyzing created files', err)
    }
  }

  isTestFile(project: WorkspaceProject, file: string, getContent: () => string) {
    const relativeId = relative(project.config.dir || project.config.root, file)
    if (mm.isMatch(relativeId, project.config.exclude)) {
      return false
    }
    if (mm.isMatch(relativeId, project.config.include)) {
      return true
    }
    if (
      project.config.includeSource?.length
      && mm.isMatch(relativeId, project.config.includeSource)
    ) {
      const source = getContent()
      return source.includes('import.meta.vitest')
    }
    return false
  }

  unwatchTests() {
    return this.watcher.stopTracking()
  }

  watchTests(files?: ExtensionTestSpecification[] | string[] | undefined, testNamePatern?: string) {
    if (files)
      this.watcher.trackTests(files.map(f => typeof f === 'string' ? f : f[1]), testNamePatern)
    else
      this.watcher.trackEveryFile()
  }

  // we need to invalidate the modules because Vitest caches the code injected by istanbul
  async invalidateIstanbulTestModules(modules: string[] | null) {
    if (!this.coverage.enabled || this.coverage.config.provider !== 'istanbul') {
      return
    }
    if (!modules) {
      this.vitest.server.moduleGraph.invalidateAll()
      return
    }
    modules.forEach((moduleId) => {
      const mod = this.vitest.server.moduleGraph.getModuleById(moduleId)
      if (mod) {
        this.invalidateTree(mod)
      }
    })
  }

  disableCoverage() {
    return this.coverage.disable()
  }

  enableCoverage() {
    return this.coverage.enable()
  }

  waitForCoverageReport() {
    return this.coverage.waitForReport()
  }

  dispose() {
    this.coverage.disable()
    this.watcher.stopTracking()
    return this.vitest.close()
  }

  close() {
    return this.dispose()
  }

  report<T extends keyof Reporter>(name: T, ...args: ArgumentsType<Reporter[T]>) {
    return (this.vitest as any).report(name, ...args)
  }

  initRpc() {
    // ignore
  }

  onBrowserDebug(fulfilled: boolean) {
    ExtensionWorker.emitter.emit('onBrowserDebug', fulfilled)
  }

  // TODO:(?) -- if environments are supported
  getModuleEnvironments() {
    return []
  }

  getTransformedModule() {
    return null
  }

  async getSourceModuleDiagnostic(_moduleId: string) {
    return {
      modules: [],
      untrackedModules: [],
    }
  }
}
