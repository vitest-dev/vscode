import type { RunnerTaskResultPack, UserConsoleLog } from 'vitest'
import type { VitestWorkerRPC, WorkerInitMetadata } from 'vitest-vscode-shared'
import type {
  BrowserCommand,
  Reporter,
  RunnerTestFile,
  TestModule,
  TestProject,
  TestSpecification,
  Vite,
  Vitest as VitestCore,
} from 'vitest/node'
import { ExtensionWorker } from './worker'

interface VSCodeReporterOptions {
  setupFilePaths: WorkerInitMetadata['setupFilePaths']
}

export class VSCodeReporter implements Reporter {
  public rpc!: VitestWorkerRPC
  private vitest!: VitestCore

  private setupFilePaths: WorkerInitMetadata['setupFilePaths']

  constructor(options: VSCodeReporterOptions) {
    this.setupFilePaths = options.setupFilePaths
  }

  onInit(vitest: VitestCore) {
    this.vitest = vitest
    vitest.projects.forEach((project) => {
      this.ensureSetupFileIsAllowed(project.vite.config)
    })
  }

  initRpc(rpc: VitestWorkerRPC) {
    this.rpc = rpc
  }

  onBrowserInit(project: TestProject) {
    const config = project.browser!.vite.config
    this.ensureSetupFileIsAllowed(config)

    const __vscode_waitForDebugger: BrowserCommand<[]> = () => {
      return new Promise<void>((resolve, reject) => {
        ExtensionWorker.emitter.on('onBrowserDebug', (fullfilled) => {
          if (fullfilled) {
            resolve()
          }
          else {
            reject(new Error(`Browser Debugger failed to connect.`))
          }
        })
      })
    }
    // TODO: move this command init to configureVitest when Vitest 4 is out
    // @ts-expect-error private "parent" property
    project.browser!.parent.commands.__vscode_waitForDebugger = __vscode_waitForDebugger
  }

  onUserConsoleLog(log: UserConsoleLog) {
    this.rpc.onConsoleLog(log)
  }

  onTaskUpdate(packs: RunnerTaskResultPack[]) {
    this.rpc.onTaskUpdate(
      // remove the meta because it is not used,
      // mark todo tests with a result, because
      // it is not set if the test was skipped during collection
      packs.map((pack) => {
        const task = this.vitest.state.idMap.get(pack[0])
        if (pack[1] || !task) {
          return [pack[0], pack[1], {}]
        }

        if (task.mode === 'todo' || task.mode === 'skip') {
          return [pack[0], { state: task.mode }, {}]
        }

        return [pack[0], pack[1], {}]
      }),
    )
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    const files = specifications.map(spec => spec.moduleId)
    this.rpc.onTestRunStart(Array.from(new Set(files)), false)
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>) {
    const files = testModules.map(m => getEntityJSONTask(m))

    if (unhandledErrors.length) {
      // TODO: remove "as unknown[]"
      this.vitest.logger.printUnhandledErrors(unhandledErrors as unknown[])
    }

    // as any because Vitest types are different between v3 and v4,
    // and shared packages uses the lowest Vitest version
    this.rpc.onTestRunEnd(files as any, '', false)
  }

  onTestModuleCollected(testModule: TestModule) {
    // TODO: is it possible to make types happy with both V3 and V4?
    this.rpc.onCollected(getEntityJSONTask(testModule) as any, false)
  }

  ensureSetupFileIsAllowed(config: Vite.ResolvedConfig) {
    ;[this.setupFilePaths.browserDebug].forEach((filepath) => {
      if (!config.server.fs.allow.includes(filepath)) {
        config.server.fs.allow.push(filepath)
      }
    })
  }

  toJSON() {
    return {}
  }
}

function getEntityJSONTask(entity: TestModule) {
  return (entity as any).task as RunnerTestFile
}
