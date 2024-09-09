import { readFileSync } from 'node:fs'
import type { Vitest as VitestCore, WorkspaceProject } from 'vitest/node'
import type { VitestMethods } from '../api/rpc'
import { VitestWatcher } from './watcher'
import { VitestCoverage } from './coverage'
import { assert, limitConcurrency } from './utils'
import { astCollectTests } from './collect'

export class Vitest implements VitestMethods {
  private readonly watcher: VitestWatcher
  private readonly coverage: VitestCoverage

  public static COLLECT_NAME_PATTERN = '$a'

  constructor(
    public readonly ctx: VitestCore,
    private readonly debug = false,
  ) {
    this.watcher = new VitestWatcher(this)
    this.coverage = new VitestCoverage(ctx, this)
  }

  public get collecting() {
    return this.ctx.configOverride.testNamePattern?.toString() === `/${Vitest.COLLECT_NAME_PATTERN}/`
  }

  public async collectTests(files: [projectName: string, filepath: string][]) {
    const browserTests: [project: WorkspaceProject, filepath: string][] = []
    const otherTests: [project: WorkspaceProject, filepath: string][] = []

    for (const [projectName, filepath] of files) {
      const project = this.ctx.projects.find(project => project.getName() === projectName)
      assert(project, `Project ${projectName} not found for file ${filepath}`)
      if (project.config.browser.enabled) {
        browserTests.push([project, filepath])
      }
      else {
        otherTests.push([project, filepath])
      }
    }

    if (browserTests.length) {
      await this.astCollect(browserTests)
    }

    if (otherTests.length) {
      const files = otherTests.map(([_, filepath]) => filepath)

      try {
        await this.runTestFiles(files, Vitest.COLLECT_NAME_PATTERN)
      }
      finally {
        this.setTestNamePattern(undefined)
      }
    }
  }

  public async astCollect(specs: [project: WorkspaceProject, file: string][]) {
    if (!specs.length) {
      return
    }

    const runConcurrently = limitConcurrency(5)

    const promises = specs.map(([project, filename]) => runConcurrently(
      () => astCollectTests(project, filename),
    ))
    const result = await Promise.all(promises)
    const files = result.filter(r => r != null).map((r => r!.file))
    this.ctx.configOverride.testNamePattern = new RegExp(Vitest.COLLECT_NAME_PATTERN)
    await this.ctx.report('onCollected', files)
    this.setTestNamePattern(undefined)
  }

  public async updateSnapshots(files?: string[] | undefined, testNamePattern?: string | undefined) {
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

  public async runTests(files: string[] | undefined, testNamePattern?: string) {
    // @ts-expect-error private method
    await this.ctx.initBrowserProviders()

    if (testNamePattern) {
      await this.runTestFiles(files || this.ctx.state.getFilepaths(), testNamePattern)
    }
    else {
      const specs = await this.globTestFiles(files)
      await this.runTestFiles(specs.map(([_, spec]) => spec), undefined, !files)
    }
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

  private coverageProcessedFiles = new Set<string>()

  private invalidateTree(mod: any, seen = new Set()) {
    if (seen.has(mod)) {
      return
    }
    if (this.coverageProcessedFiles.has(mod.file)) {
      return
    }
    this.coverageProcessedFiles.add(mod.file)
    seen.add(mod)
    this.ctx.server.moduleGraph.invalidateModule(mod)
    mod.clientImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
    mod.ssrImportedModules.forEach((mod: any) => {
      this.invalidateTree(mod)
    })
  }

  private async runTestFiles(files: string[], testNamePattern?: string | undefined, runAllFiles = false) {
    await this.ctx.runningPromise
    this.watcher.markRerun(false)

    this.setTestNamePattern(testNamePattern)

    // populate cache so it can find test files
    if (this.debug)
      await this.globTestFiles(files)

    if (this.coverage.resolved) {
      files.forEach((file) => {
        if (!this.coverageProcessedFiles.has(file)) {
          const mod = this.ctx.server.moduleGraph.getModuleById(file)
          if (mod) {
            this.invalidateTree(mod)
          }
          this.coverageProcessedFiles.add(file)
        }
      })
    }

    await this.rerunTests(files, runAllFiles)
  }

  private setTestNamePattern(pattern: string | undefined) {
    this.ctx.configOverride.testNamePattern = pattern ? new RegExp(pattern) : undefined
  }

  private async rerunTests(files: string[], runAllFiles = false) {
    await this.ctx.report('onWatcherRerun', files)
    await this.ctx.runFiles(files.flatMap(file => this.ctx.getProjectsByTestFile(file)), runAllFiles)

    await this.ctx.report('onWatcherStart', this.ctx.state.getFiles(files))
  }

  private handleFileChanged(file: string): string[] {
    return (this.ctx as any).handleFileChanged(file)
  }

  private scheduleRerun(files: string[]): Promise<void> {
    return (this.ctx as any).scheduleRerun(files)
  }

  private updateLastChanged(filepath: string) {
    const projects = this.ctx.getModuleProjects(filepath)
    projects.forEach(({ server, browser }) => {
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
        const needRerun = this.handleFileChanged(file)
        if (needRerun.length) {
          this.updateLastChanged(file)
          this.scheduleRerun(needRerun)
        }
      }
    }
    catch (err) {
      console.error('Error during analyzing changed files', err)
    }
  }

  async onFilesCreated(files: string[]) {
    try {
      const testFiles: string[] = []

      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        for (const project of this.ctx.projects) {
          if (await project.isTargetFile(file, content)) {
            this.updateLastChanged(file)
            testFiles.push(file)
          }
        }
      }

      testFiles.forEach(file => this.scheduleRerun([file]))
    }
    catch (err) {
      console.error('Error during analyzing created files', err)
    }
  }

  unwatchTests() {
    return this.watcher.stopTracking()
  }

  watchTests(files?: string[], testNamePatern?: string) {
    if (files)
      this.watcher.trackTests(files, testNamePatern)
    else
      this.watcher.trackEveryFile()
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
