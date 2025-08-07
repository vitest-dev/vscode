import type { BirpcReturn } from 'birpc'
import type { RunnerTestFile, TaskResultPack, UserConsoleLog } from 'vitest'
import type { Vitest as VitestCore, WorkspaceProject } from 'vitest/node'
import type { Reporter } from 'vitest/reporters'
import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from '../api/rpc'
import { Console } from 'node:console'
import { nextTick } from 'node:process'
import { Writable } from 'node:stream'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import { setupFilePath } from '../constants'
import { ExtensionWorker } from './worker'

export class VSCodeReporter implements Reporter {
  public rpc!: BirpcReturn<ExtensionWorkerEvents, ExtensionWorkerTransport>
  private vitest!: VitestCore

  private get collecting(): boolean {
    return (this.vitest as any).configOverride.testNamePattern?.toString() === `/${ExtensionWorker.COLLECT_NAME_PATTERN}/`
  }

  onInit(vitest: VitestCore) {
    this.vitest = vitest
    const server = vitest.server.config.server
    if (!server.fs.allow.includes(setupFilePath))
      server.fs.allow.push(setupFilePath)
    vitest.projects.forEach((project) => {
      project.config.setupFiles = [
        ...project.config.setupFiles || [],
        setupFilePath,
      ]
      const server = project.server.config.server
      if (!server.fs.allow.includes(setupFilePath))
        server.fs.allow.push(setupFilePath)
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
      if (!config.fs.allow.includes(setupFilePath))
        config.fs.allow.push(setupFilePath)
    })
  }

  overrideInitBrowserProvider(project: WorkspaceProject, name: string) {
    // @ts-expect-error internal
    const original = project[name].bind(project)
    // @ts-expect-error internal
    project[name] = async function _initBrowserProvider(this: WorkspaceProject) {
      await original()
      if (!this.browser) {
        return
      }
      const config = this.browser!.vite.config
      if (!config.server.fs.allow.includes(setupFilePath)) {
        config.server.fs.allow.push(setupFilePath)
      }
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

  onWatcherStart(files?: RunnerTestFile[], errors?: unknown[]) {
    this.rpc.onWatcherStart(files, errors, this.collecting)
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.rpc.onWatcherRerun(files, trigger, this.collecting)
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
