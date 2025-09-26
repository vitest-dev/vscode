import type { BirpcReturn } from 'birpc'
import type { RunnerTestFile, TaskResultPack, UserConsoleLog } from 'vitest'
import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from 'vitest-vscode-shared'
import type { BrowserCommand, Vitest as VitestCore, WorkspaceProject } from 'vitest/node'
import type { Reporter } from 'vitest/reporters'
import { Console } from 'node:console'
import { nextTick } from 'node:process'
import { Writable } from 'node:stream'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import { ExtensionWorker } from './worker'

interface VSCodeReporterOptions {
  setupFilePaths: string[]
}

export class VSCodeReporter implements Reporter {
  public rpc!: BirpcReturn<ExtensionWorkerEvents, ExtensionWorkerTransport>
  private vitest!: VitestCore
  private setupFilePaths: string[]

  constructor(options: VSCodeReporterOptions) {
    this.setupFilePaths = options.setupFilePaths
  }

  private get collecting(): boolean {
    return (this.vitest as any).configOverride.testNamePattern?.toString() === `/${ExtensionWorker.COLLECT_NAME_PATTERN}/`
  }

  onInit(vitest: VitestCore) {
    this.vitest = vitest
    const server = vitest.server.config.server
    this.setupFilePaths.forEach((setupFile) => {
      if (!server.fs.allow.includes(setupFile))
        server.fs.allow.push(setupFile)
      vitest.projects.forEach((project) => {
        project.config.setupFiles = [
          ...project.config.setupFiles || [],
          setupFile,
        ]
        const server = project.server.config.server
        if (!server.fs.allow.includes(setupFile))
          server.fs.allow.push(setupFile)
        // @ts-expect-error internal, Vitest 3
        if (project._initBrowserProvider) {
          this.overrideInitBrowserProvider(project, '_initBrowserProvider')
        }
        // @ts-expect-error internal, Vitest 2
        else if (project.initBrowserProvider) {
          this.overrideInitBrowserProvider(project, 'initBrowserProvider')
        }
        const browser = project.browser as any
        if (!browser) {
          return
        }
        const config = 'vite' in browser ? browser.vite.config.server : browser.config.server
        if (!config.fs.allow.includes(setupFile))
          config.fs.allow.push(setupFile)
      })
    })
  }

  overrideInitBrowserProvider(project: WorkspaceProject, name: string) {
    // @ts-expect-error internal
    const original = project[name].bind(project)
    const setupFilePaths = this.setupFilePaths
    // @ts-expect-error internal
    project[name] = async function _initBrowserProvider(this: WorkspaceProject) {
      await original()
      if (!this.browser) {
        return
      }
      const config = this.browser!.vite.config
      setupFilePaths.forEach((setupFile) => {
        if (!config.server.fs.allow.includes(setupFile)) {
          config.server.fs.allow.push(setupFile)
        }
      })
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
      if (!('parent' in this.browser) || !('commands' in (this.browser.parent as any))) {
        return
      }
      // @ts-expect-error private "parent" property
      this.browser!.parent.commands.__vscode_waitForDebugger = __vscode_waitForDebugger
    }
  }

  initRpc(rpc: BirpcReturn<ExtensionWorkerEvents, ExtensionWorkerTransport>) {
    this.rpc = rpc
  }

  onUserConsoleLog(log: UserConsoleLog) {
    this.rpc.onConsoleLog(log)
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    packs.forEach(([taskId, result]) => {
      const project = this.vitest.getProjectByTaskId(taskId)

      // the new version uses browser.parseErrorStacktrace
      if ('getBrowserSourceMapModuleById' in project) {
        result?.errors?.forEach((error) => {
          if (typeof error === 'object' && error) {
            error.stacks = parseErrorStacktrace(error, {
              getSourceMap: file => (project as any).getBrowserSourceMapModuleById(file),
            })
          }
        })
        return
      }

      const task = this.vitest.state.idMap.get(taskId)
      const isBrowser = task && task.file?.pool === 'browser'

      result?.errors?.forEach((error) => {
        if (isPrimitive(error)) {
          return
        }

        const stacks = isBrowser
          ? project.browser?.parseErrorStacktrace(error)
          : parseErrorStacktrace(error)
        error.stacks = stacks
      })
    })

    this.rpc.onTaskUpdate(packs)
  }

  async onFinished(files?: RunnerTestFile[], errors: unknown[] = this.vitest.state.getUnhandledErrors()) {
    const collecting = this.collecting

    let output = ''
    if (errors.length) {
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          output += String(chunk)
          callback()
        },
      })
      const _console = this.vitest.logger.console
      const errorStream = this.vitest.logger.errorStream
      const outputStream = this.vitest.logger.outputStream
      this.vitest.logger.errorStream = writable as any
      this.vitest.logger.outputStream = writable as any
      this.vitest.logger.console = new Console(writable, writable)
      await this.vitest.logger.printUnhandledErrors(errors)
      this.vitest.logger.console = _console
      this.vitest.logger.errorStream = errorStream
      this.vitest.logger.outputStream = outputStream
    }
    nextTick(() => {
      this.rpc.onTestRunEnd(files || [], output, collecting)
    })
  }

  onCollected(files?: RunnerTestFile[]) {
    files?.forEach(file => this.rpc.onCollected(file, this.collecting))
  }

  onWatcherRerun(files: string[]) {
    this.rpc.onTestRunStart(files, this.collecting)
  }

  toJSON() {
    return {}
  }
}

function isPrimitive(value: unknown) {
  return (
    value === null || (typeof value !== 'function' && typeof value !== 'object')
  )
}
