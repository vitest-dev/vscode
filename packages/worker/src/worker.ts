import type {
  ExtensionEnvironment,
  ExtensionTestFileSpecification,
  ExtensionTestSpecification,
  ExtensionWorkerTransport,
  VitestWorkerRPC,
  WorkerWSEventEmitter,
} from 'vitest-vscode-shared'
import type { Vitest as VitestCore } from 'vitest/node'
import EventEmitter from 'node:events'
import { ExtensionWorkerRunner } from './runner'
import { ExtensionWorkerWatcher } from './watcher'

export class ExtensionWorker implements ExtensionWorkerTransport {
  private readonly watcher: ExtensionWorkerWatcher
  private readonly runner: ExtensionWorkerRunner

  static emitter = new EventEmitter()

  constructor(
    public readonly vitest: VitestCore,
    debug = false,
    ws: WorkerWSEventEmitter,
  ) {
    this.runner = new ExtensionWorkerRunner(vitest, debug, ws)
    this.watcher = new ExtensionWorkerWatcher(vitest, this.runner)
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

  async watchTests(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    // Reset previous tracking state so re-clicking continuous run
    // picks up the new files/pattern instead of appending to old ones
    this.watcher.stopTracking()

    if (testNamePattern) {
      this.vitest.setGlobalTestNamePattern(testNamePattern)
    }
    else {
      this.vitest.resetGlobalTestNamePattern()
    }

    // Ensure test files are globbed so vitest's watcher can recognize them
    // on file change (fresh process hasn't run globTestSpecifications yet)
    await this.vitest.globTestSpecifications()

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

  onFilesChanged(files: string[]): void {
    files.forEach(file => this.vitest.watcher.onFileChange(file))
  }

  onFilesCreated(files: string[]): void {
    files.forEach(file => this.vitest.watcher.onFileCreate(file))
  }

  async dispose() {
    this.watcher.stopTracking()
    await this.vitest.close()
  }

  close() {
    return this.dispose()
  }

  initRpc(rpc: VitestWorkerRPC) {
    this.runner.initRpc(rpc)
  }

  getModuleEnvironments(moduleId: string): ExtensionEnvironment[] {
    return this.vitest.projects.map((project) => {
      const environments = new Map<string, { timestamp: number }>()
      for (const name in project.vite.environments) {
        const environment = project.vite.environments[name]
        const nodes = [...environment.moduleGraph.getModulesByFile(moduleId) || []]
        if (nodes.some(n => n.transformResult)) {
          environments.set(name, { timestamp: nodes[0].lastInvalidationTimestamp })
        }
      }
      return {
        name: project.name,
        environments: Array.from(environments).map(([name, { timestamp }]) => ({
          name,
          transformTimestamp: timestamp,
        })),
      }
    })
  }

  getTransformedModule(projectName: string, environmentName: string, moduleId: string) {
    const project = this.vitest.projects.find(p => p.name === projectName)
    const environment = environmentName === '__browser__'
      ? project?.browser?.vite?.environments.client
      : project?.vite.environments[environmentName]
    const files = environment?.moduleGraph.getModulesByFile(moduleId)
    if (!files || !files.size) {
      return null
    }
    return files.values().next().value?.transformResult?.code ?? null
  }

  async getSourceModuleDiagnostic(moduleId: string) {
    if (!this.vitest.experimental_getSourceModuleDiagnostic) {
      return {
        modules: [],
        untrackedModules: [],
      }
    }
    return await this.vitest.experimental_getSourceModuleDiagnostic(moduleId)
  }

  onBrowserDebug(fulfilled: boolean) {
    ExtensionWorker.emitter.emit('onBrowserDebug', fulfilled)
  }
}
