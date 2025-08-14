import type {
  ExtensionTestSpecification,
  ExtensionWorkerTransport,
  VitestWorkerRPC,
  WorkerWSEventEmitter,
} from 'vitest-vscode-shared'
import type { TestSpecification, Vitest as VitestCore } from 'vitest/node'
import { ExtensionCoverageManager } from './coverage'
import { ExtensionWorkerWatcher } from './watcher'

export class ExtensionWorker implements ExtensionWorkerTransport {
  private readonly watcher: ExtensionWorkerWatcher
  private readonly coverage: ExtensionCoverageManager

  private rpc!: VitestWorkerRPC

  constructor(
    public readonly vitest: VitestCore,
    private readonly debug = false,
    public readonly alwaysAstCollect = false,
    private emitter: WorkerWSEventEmitter,
  ) {
    this.watcher = new ExtensionWorkerWatcher(vitest)
    this.coverage = new ExtensionCoverageManager(vitest)
  }

  async getFiles(): Promise<ExtensionTestSpecification[]> {
    this.vitest.clearSpecificationsCache()
    const specifications = await this.vitest.globTestSpecifications()
    return specifications.map(spec => [spec.project.name, spec.moduleId])
  }

  async collectTests(testFiles: ExtensionTestSpecification[]): Promise<void> {
    const specifications = await this.resolveTestSpecifications(testFiles)
    const testModules = await this.vitest.experimental_parseSpecifications(specifications)
    const promises = testModules.map(module =>
      // TODO: fix "as any"
      this.rpc.onCollected((module as any).task, true),
    )
    await Promise.all(promises)
  }

  cancelRun(): Promise<void> {
    return this.vitest.cancelCurrentRun('keyboard-input')
  }

  async runTests(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    if (testNamePattern) {
      this.vitest.setGlobalTestNamePattern(testNamePattern)
    }

    if (!filesOrDirectories || this.isOnlyDirectories(filesOrDirectories)) {
      const specifications = await this.vitest.getRelevantTestSpecifications(filesOrDirectories)
      await this.vitest.rerunTestSpecifications(specifications, true)
    }
    else {
      const specifications = await this.resolveTestSpecifications(filesOrDirectories)
      await this.vitest.rerunTestSpecifications(specifications, false)
    }

    // debugger never runs in watch mode
    if (this.debug) {
      await this.vitest.close()
      this.emitter.close()
    }
  }

  async resolveTestSpecifications(files: ExtensionTestSpecification[]): Promise<TestSpecification[]> {
    const specifications: TestSpecification[] = []
    files.forEach((file) => {
      const [projectName, filepath] = file
      const project = this.vitest.getProjectByName(projectName)
      specifications.push(project.createSpecification(filepath))
    })
    return specifications
  }

  async updateSnapshots(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    this.vitest.enableSnapshotUpdate()
    try {
      return await this.runTests(filesOrDirectories, testNamePattern)
    }
    finally {
      this.vitest.resetSnapshotUpdate()
    }
  }

  watchTests(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): void {
    if (testNamePattern) {
      this.vitest.setGlobalTestNamePattern(testNamePattern)
    }

    if (!filesOrDirectories) {
      this.watcher.trackEveryFile()
    }
    else {
      this.watcher.trackTestItems(filesOrDirectories)
    }
  }

  unwatchTests() {
    this.watcher.stopTracking()
  }

  async invalidateIstanbulTestModules(): Promise<void> {
    // do nothing, because Vitest 4 supports this out of the box
  }

  async enableCoverage(): Promise<void> {
    await this.coverage.enableCoverage()
  }

  disableCoverage(): void {
    this.coverage.disableCoverage()
  }

  waitForCoverageReport(): Promise<string | null> {
    return this.coverage.waitForReport()
  }

  onFilesChanged(files: string[]): void {
    files.forEach(file => this.vitest.watcher.onFileChange(file))
  }

  onFilesCreated(files: string[]): void {
    files.forEach(file => this.vitest.watcher.onFileCreate(file))
  }

  dispose() {
    this.coverage.disableCoverage()
    this.watcher.stopTracking()
    return this.vitest.close()
  }

  close() {
    return this.dispose()
  }

  initRpc(rpc: VitestWorkerRPC) {
    this.rpc = rpc
  }

  private isOnlyDirectories(filesOrDirectories: ExtensionTestSpecification[] | string[]): filesOrDirectories is string[] {
    return typeof filesOrDirectories[0] === 'string'
  }
}
