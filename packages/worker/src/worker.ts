import type {
  ExtensionTestFileSpecification,
  ExtensionTestSpecification,
  ExtensionWorkerTransport,
  VitestWorkerRPC,
  WorkerWSEventEmitter,
} from 'vitest-vscode-shared'
import type { Vitest as VitestCore } from 'vitest/node'
import EventEmitter from 'node:events'
import { ExtensionCoverageManager } from './coverage'
import { ExtensionWorkerRunner } from './runner'
import { ExtensionWorkerWatcher } from './watcher'

export class ExtensionWorker implements ExtensionWorkerTransport {
  private readonly watcher: ExtensionWorkerWatcher
  private readonly coverage: ExtensionCoverageManager
  private readonly runner: ExtensionWorkerRunner

  static emitter = new EventEmitter()

  constructor(
    public readonly vitest: VitestCore,
    debug = false,
    ws: WorkerWSEventEmitter,
  ) {
    this.runner = new ExtensionWorkerRunner(vitest, debug, ws)
    this.watcher = new ExtensionWorkerWatcher(vitest, this.runner)
    this.coverage = new ExtensionCoverageManager(vitest)
  }

  async getFiles(): Promise<ExtensionTestFileSpecification[]> {
    return this.runner.getFiles()
  }

  async collectTests(testFiles: ExtensionTestSpecification[]): Promise<void> {
    return this.runner.collectTests(testFiles)
  }

  cancelRun(): Promise<void> {
    return this.runner.cancelRun()
  }

  async runTests(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    await this.runner.runTests(filesOrDirectories, testNamePattern)
  }

  async updateSnapshots(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    return this.runner.updateSnapshots(filesOrDirectories, testNamePattern)
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
    this.runner.initRpc(rpc)
  }

  onBrowserDebug(fulfilled: boolean) {
    ExtensionWorker.emitter.emit('onBrowserDebug', fulfilled)
  }
}
