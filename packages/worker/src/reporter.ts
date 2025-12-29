import type { RunnerTaskResultPack, UserConsoleLog } from 'vitest'
import type { VitestWorkerRPC, WorkerInitMetadata, WorkerRunnerOptions } from 'vitest-vscode-shared'
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
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import { ExtensionWorker } from './worker'

interface VSCodeReporterOptions {
  setupFilePaths: WorkerInitMetadata['setupFilePaths']
  debug: WorkerRunnerOptions['debug']
}

export class VSCodeReporter implements Reporter {
  public rpc!: VitestWorkerRPC
  private vitest!: VitestCore

  private setupFilePaths: WorkerInitMetadata['setupFilePaths']
  private debug: WorkerRunnerOptions['debug']

  private debuggerAttached: boolean | undefined = undefined

  constructor(options: VSCodeReporterOptions) {
    this.setupFilePaths = options.setupFilePaths
    this.debug = options.debug
  }

  onInit(vitest: VitestCore) {
    this.vitest = vitest
    this.configureBrowserDebugging(vitest)

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
        if (this.debuggerAttached !== undefined) {
          //
          // An attachment attempt has already been made
          //
          if (this.debuggerAttached) {
            //
            // Already attached, resolve immediately
            //
            resolve()
            return
          }
          else if (this.debuggerAttached === false) {
            //
            // Already failed to attach
            //
            reject(new Error(`Browser Debugger failed to connect.`))
            return
          }
        }

        //
        // We haven't tried to attach yet, wait for the event
        //
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
    // Parse stack trace to extract file location for inline display
    const extendedLog = log as any
    if (log.origin) {
      try {
        const task = log.taskId ? this.vitest.state.idMap.get(log.taskId) : null
        const project = task
          ? this.vitest.state.getReportedEntity(task)!.project
          : this.vitest.getRootProject()
        const stacks = log.browser
          ? project.browser?.parseErrorStacktrace({ stack: log.origin } as any)
          : parseErrorStacktrace({ stack: log.origin } as any)

        if (stacks && stacks.length > 0) {
          const firstStack = stacks[0]
          if (firstStack.file && firstStack.line != null && firstStack.column != null) {
            extendedLog.parsedLocation = {
              file: firstStack.file,
              line: firstStack.line - 1, // Convert to 0-based
              column: firstStack.column,
            }
          }
        }
      }
      catch {
        // If parsing fails, continue without parsed location
      }
    }
    this.rpc.onConsoleLog(extendedLog)
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
    this.vitest.state.filesMap.clear()
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

  configureBrowserDebugging(vitest: VitestCore) {
    //
    // Listen for debugger attachment events as soon as possible to prevent a deadlock
    //
    ExtensionWorker.emitter.on('onBrowserDebug', (fullfilled) => {
      this.debuggerAttached = fullfilled
    })

    //
    // Note: This is too late to enable the inspector itself, but we can still add setup files
    //
    if (this.debug !== undefined && typeof this.debug === 'object') {
      vitest.projects.forEach((project) => {
        if (project.config.browser?.enabled) {
          project.config.setupFiles.push(this.setupFilePaths.browserDebug)
        }
      })
    }
  }

  toJSON() {
    return {}
  }
}

function getEntityJSONTask(entity: TestModule) {
  return (entity as any).task as RunnerTestFile
}
