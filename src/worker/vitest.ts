import type { Vitest as VitestCore } from 'vitest'
import type { VitestMethods } from '../api/rpc'
import { VitestWatcher } from './watcher'
import { VitestCoverage } from './coverage'
import { VitestDebugger } from './debugger'

const cwd = process.cwd()

export class Vitest implements VitestMethods {
  private readonly watcher: VitestWatcher
  private readonly coverage: VitestCoverage
  private readonly debugger: VitestDebugger

  public static COLLECT_NAME_PATTERN = '$a'

  constructor(
    private readonly cwd: string,
    private readonly ctx: VitestCore,
  ) {
    this.watcher = new VitestWatcher(ctx)
    this.coverage = new VitestCoverage(ctx, this)
    this.debugger = new VitestDebugger(ctx, this)
  }

  public get collecting() {
    return this.ctx.configOverride.testNamePattern?.toString() === `/${Vitest.COLLECT_NAME_PATTERN}/`
  }

  public async collectTests(files: string[]) {
    try {
      await this.runTestFiles(files, Vitest.COLLECT_NAME_PATTERN)
    }
    finally {
      this.setTestNamePattern(undefined)
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
      await this.runTestFiles(specs.map(([_, spec]) => spec))
    }
  }

  public cancelRun() {
    return this.ctx.cancelCurrentRun('keyboard-input')
  }

  public async getFiles(): Promise<[project: string, file: string][]> {
    const files = await this.globTestFiles()
    // reset cached test files list
    this.ctx.projects.forEach((project) => {
      project.testFilesList = null
    })
    return files.map(([project, spec]) => [project.config.name || '', spec])
  }

  private async globTestFiles(filters?: string[]) {
    process.chdir(this.cwd)
    const files = await this.ctx.globTestFiles(filters)
    process.chdir(cwd)
    return files
  }

  private async runTestFiles(files: string[], testNamePattern?: string | undefined) {
    await this.ctx.runningPromise
    this.watcher.markRerun(false)
    process.chdir(this.cwd)

    try {
      this.setTestNamePattern(testNamePattern)

      await this.rerunTests(files)
    }
    finally {
      process.chdir(cwd)
    }
  }

  private setTestNamePattern(pattern: string | undefined) {
    this.ctx.configOverride.testNamePattern = pattern ? new RegExp(pattern) : undefined
  }

  private async rerunTests(files: string[]) {
    await this.ctx.report('onWatcherRerun', files)
    await this.ctx.runFiles(files.flatMap(file => this.ctx.getProjectsByTestFile(file)), false)

    await this.ctx.report('onWatcherStart', this.ctx.state.getFiles(files))
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

  startInspect(port: number, address?: string) {
    this.debugger.start(port, address)
  }

  stopInspect() {
    this.debugger.stop()
  }

  waitForCoverageReport() {
    return this.coverage.waitForReport()
  }

  dispose() {
    this.coverage.disable()
    this.watcher?.stopTracking()
    return this.ctx.close()
  }
}
