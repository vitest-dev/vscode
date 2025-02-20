import { readFileSync } from 'node:fs'
import type { Vitest as VitestCore, WorkspaceProject } from 'vitest/node'
import { relative } from 'pathe'
import mm from 'micromatch'
import type { ExtensionWorkerTransport, SerializedTestSpecification } from '../api/rpc'
import { ExtensionWorkerWatcher } from './watcher'
import { ExtensionCoverageManager } from './coverage'
import { assert, limitConcurrency } from './utils'
import { astCollectTests, createFailedFileTask } from './collect'

const verbose = process.env.VITEST_VSCODE_LOG === 'verbose'
  ? (...args: any[]) => {
      // eslint-disable-next-line no-console
      console.info(...args)
    }
  : undefined

export class ExtensionWorker implements ExtensionWorkerTransport {
  private readonly watcher: ExtensionWorkerWatcher
  private readonly coverage: ExtensionCoverageManager

  public static COLLECT_NAME_PATTERN = '$a'

  constructor(
    public readonly ctx: VitestCore,
    private readonly debug = false,
    public readonly alwaysAstCollect = false,
  ) {
    this.watcher = new ExtensionWorkerWatcher(this)
    this.coverage = new ExtensionCoverageManager(this)
  }

  public get collecting() {
    return this.ctx.configOverride.testNamePattern?.toString() === `/${ExtensionWorker.COLLECT_NAME_PATTERN}/`
  }

  public getRootTestProject(): WorkspaceProject {
    // vitest 3 uses getRootProject
    if ('getRootProject' in this.ctx) {
      return (this.ctx.getRootProject as () => WorkspaceProject)()
    }
    // vitest 3.beta uses getRootTestProject
    if ('getRootTestProject' in this.ctx) {
      return (this.ctx.getRootTestProject as () => WorkspaceProject)()
    }
    return this.ctx.getCoreWorkspaceProject()
  }

  public async collectTests(files: [projectName: string, filepath: string][]) {
    const astCollect: [project: WorkspaceProject, filepath: string][] = []
    const otherTests: [project: WorkspaceProject, filepath: string][] = []

    for (const [projectName, filepath] of files) {
      const project = this.ctx.projects.find(project => project.getName() === projectName)
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
          await this.astCollect(astCollect, 'web')
        }
      })(),
      (async () => {
        if (otherTests.length) {
          const files = otherTests.map<SerializedTestSpecification>(
            ([project, filepath]) => [{ name: project.getName() }, filepath],
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

  public async astCollect(specs: [project: WorkspaceProject, file: string][], transformMode: 'web' | 'ssr') {
    if (!specs.length) {
      return
    }

    const runConcurrently = limitConcurrency(5)

    const promises = specs.map(([project, filename]) => runConcurrently(
      () => astCollectTests(project, filename, transformMode).catch(err => createFailedFileTask(project, filename, err)),
    ))
    const files = await Promise.all(promises)
    this.ctx.configOverride.testNamePattern = new RegExp(ExtensionWorker.COLLECT_NAME_PATTERN)
    await this.ctx.report('onCollected', files)
    this.setTestNamePattern(undefined)
  }

  public async updateSnapshots(files?: SerializedTestSpecification[] | string[] | undefined, testNamePattern?: string | undefined) {
    this.ctx.configOverride.snapshotOptions = {
      updateSnapshot: 'all',
      // environment is resolved inside a worker thread
      snapshotEnvironment: null as any,
    }
    try {
      return await this.runTests(files, testNamePattern)
    }
    finally {
      delete this.ctx.configOverride.snapshotOptions
    }
  }

  async resolveTestSpecs(specs: string[] | SerializedTestSpecification[] | undefined): Promise<SerializedTestSpecification[]> {
    if (!specs || typeof specs[0] === 'string') {
      const files = await this.globTestFiles(specs as string[] | undefined)
      return files.map<SerializedTestSpecification>(([project, file]) => {
        return [{ name: project.getName() }, file]
      })
    }
    return (specs || []) as SerializedTestSpecification[]
  }

  public async runTests(specsOrPaths: SerializedTestSpecification[] | string[] | undefined, testNamePattern?: string) {
    // @ts-expect-error private method in Vitest <=2.1.5
    await this.ctx.initBrowserProviders?.()

    const specs = await this.resolveTestSpecs(specsOrPaths)

    await this.runTestFiles(specs, testNamePattern, !specsOrPaths)
  }

  public cancelRun() {
    return this.ctx.cancelCurrentRun('keyboard-input')
  }

  public async getFiles(): Promise<[project: string, file: string][]> {
    // reset cached test files list
    this.ctx.projects.forEach((project) => {
      project.testFilesList = null
    })
    const files = await this.globTestFiles()
    return files.map(([project, spec]) => [project.config.name || '', spec])
  }

  private async globTestFiles(filters?: string[]) {
    return await this.ctx.globTestFiles(filters)
  }

  private invalidateTree(mod: any, seen = new Set()) {
    if (seen.has(mod)) {
      return
    }
    seen.add(mod)
    this.ctx.server.moduleGraph.invalidateModule(mod)
    mod.clientImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
    mod.ssrImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
  }

  private async runTestFiles(specs: SerializedTestSpecification[], testNamePattern?: string | undefined, runAllFiles = false) {
    await this.ctx.runningPromise
    this.watcher.markRerun(false)

    this.setTestNamePattern(testNamePattern)

    // populate cache so it can find test files
    if (this.debug)
      await this.globTestFiles(specs.map(f => f[1]))

    await this.rerunTests(specs, runAllFiles)
  }

  private setTestNamePattern(pattern: string | undefined) {
    this.ctx.configOverride.testNamePattern = pattern ? new RegExp(pattern) : undefined
  }

  private async rerunTests(specs: SerializedTestSpecification[], runAllFiles = false) {
    const paths = specs.map(spec => spec[1])

    const specsToRun = specs.flatMap((spec) => {
      const file = typeof spec === 'string' ? spec : spec[1]
      const fileSpecs = this.ctx.getFileWorkspaceSpecs
        ? this.ctx.getFileWorkspaceSpecs(file)
        // supported by the older version
        : this.ctx.getProjectsByTestFile(file)
      if (!fileSpecs.length) {
        return []
      }
      return fileSpecs.filter(([project]) => project.getName() === spec[0].name)
    })
    await Promise.all([
      this.ctx.report('onWatcherRerun', paths),
      // `_onUserTestsRerun` exists only in Vitest 3 and it's private
      // the extension needs to migrate to the new API
      ...((this.ctx as any)._onUserTestsRerun || []).map((fn: any) => fn(specs)),
    ])

    await this.ctx.runFiles(specsToRun, runAllFiles)

    await this.ctx.report('onWatcherStart', this.ctx.state.getFiles(paths))
  }

  private handleFileChanged(file: string): string[] {
    const ctx = this.ctx as any
    // support Vitest 3
    if (ctx.watcher) {
      return ctx.watcher.handleFileChanged(file) ? [file] : []
    }
    return ctx.handleFileChanged(file)
  }

  private scheduleRerun(files: string[]): Promise<void> {
    return (this.ctx as any).scheduleRerun(files)
  }

  private updateLastChanged(filepath: string) {
    this.ctx.projects.forEach(({ server, browser }) => {
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
      this.ctx.logger.error('Error during analyzing changed files', err)
    }
  }

  async onFilesCreated(files: string[]) {
    try {
      const testFiles: string[] = []

      for (const file of files) {
        this.updateLastChanged(file)
        let content: string | null = null
        const projects = []
        for (const project of this.ctx.projects) {
          if (this.isTestFile(
            project,
            file,
            () => content ?? (content = readFileSync(file, 'utf-8')),
          )) {
            testFiles.push(file)
            project.testFilesList?.push(file)
            this.ctx.changedTests.add(file)
            projects.push(project)
          }
          else {
            verbose?.('file', file, 'is not part of workspace', project.getName() || 'core')
          }
        }
        // to support Vitest 1.4.0
        if (projects.length && (this.ctx as any).projectsTestFiles) {
          (this.ctx as any).projectsTestFiles.set(file, new Set(projects))
        }
      }

      testFiles.forEach(file => this.scheduleRerun([file]))
    }
    catch (err) {
      this.ctx.logger.error('Error during analyzing created files', err)
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

  watchTests(files?: SerializedTestSpecification[] | string[] | undefined, testNamePatern?: string) {
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
      this.ctx.server.moduleGraph.invalidateAll()
      return
    }
    modules.forEach((moduleId) => {
      const mod = this.ctx.server.moduleGraph.getModuleById(moduleId)
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
    return this.ctx.close()
  }

  close() {
    return this.dispose()
  }
}
