import type { ExtensionTestFileSpecification, ExtensionTestSpecification, VitestWorkerRPC, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { TestSpecification, Vitest as VitestCore } from 'vitest/node'

export class ExtensionWorkerRunner {
  private rpc!: VitestWorkerRPC

  constructor(
    public readonly vitest: VitestCore,
    private readonly debug = false,
    private emitter: WorkerWSEventEmitter,
  ) {}

  async getFiles(): Promise<ExtensionTestFileSpecification[]> {
    this.vitest.clearSpecificationsCache()
    const specifications = await this.vitest.globTestSpecifications()
    return specifications.map((spec) => {
      const config = spec.project.config
      return [
        spec.moduleId,
        {
          project: spec.project.name,
          pool: config.pool,
          browser: config.browser?.enabled
            ? {
                provider: config.browser.provider?.name || 'preview',
                name: config.browser.name,
                webRoot: config.root,
              }
            : undefined,
        },
      ]
    })
  }

  async collectTests(testFiles: ExtensionTestSpecification[]): Promise<void> {
    const specifications = await this.resolveTestSpecifications(testFiles)
    await this.collectSpecifications(specifications)
  }

  public async collectSpecifications(specifications: TestSpecification[]): Promise<void> {
    const testModules = await this.vitest.experimental_parseSpecifications(specifications)
    const promises = testModules.map(module =>
      // TODO: fix "as any"
      this.rpc.onCollected((module as any).task, true),
    )
    await Promise.all(promises)
  }

  initRpc(rpc: VitestWorkerRPC) {
    this.rpc = rpc
  }

  cancelRun(): Promise<void> {
    return this.vitest.cancelCurrentRun('keyboard-input')
  }

  async runTests(filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string): Promise<void> {
    const currentTestNamePattern = this.getGlobalTestNamePattern()
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

    if (currentTestNamePattern) {
      this.vitest.setGlobalTestNamePattern(currentTestNamePattern)
    }
    else {
      this.vitest.resetGlobalTestNamePattern()
    }
  }

  // TODO: use vitest.getGlobalTestNamePattern when merged
  private getGlobalTestNamePattern(): RegExp | undefined {
    if ((this.vitest as any).configOverride.testNamePattern != null) {
      return (this.vitest as any).configOverride.testNamePattern
    }
    return this.vitest.config.testNamePattern
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
    const currentTestNamePattern = this.getGlobalTestNamePattern()
    this.vitest.enableSnapshotUpdate()
    try {
      return await this.runTests(filesOrDirectories, testNamePattern)
    }
    finally {
      if (currentTestNamePattern) {
        this.vitest.setGlobalTestNamePattern(currentTestNamePattern)
      }
      else {
        this.vitest.resetSnapshotUpdate()
      }
    }
  }

  private isOnlyDirectories(
    filesOrDirectories: ExtensionTestSpecification[] | string[],
  ): filesOrDirectories is string[] {
    return typeof filesOrDirectories[0] === 'string'
  }
}
