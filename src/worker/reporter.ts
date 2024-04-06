import { nextTick } from 'node:process'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { File, Reporter, TaskResultPack, UserConsoleLog, Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'
import { setupFilePath } from '../constants'

export class VSCodeReporter implements Reporter {
  private rpc!: BirpcReturn<BirpcEvents, BirpcMethods>
  private ctx!: Vitest
  private id!: string

  get isCollecting(): boolean {
    return this.ctx.configOverride.testNamePattern?.toString() === '/$a/'
  }

  initVitest(ctx: Vitest, id: string) {
    this.ctx = ctx
    this.id = id
    ctx.config.setupFiles = [
      ...ctx.config.setupFiles || [],
      setupFilePath,
    ]
    ctx.projects.forEach((project) => {
      project.config.setupFiles = [
        ...project.config.setupFiles || [],
        setupFilePath,
      ]
    })
  }

  initRpc(rpc: BirpcReturn<BirpcEvents, BirpcMethods>) {
    this.rpc = rpc
  }

  onUserConsoleLog(log: UserConsoleLog) {
    this.rpc.onConsoleLog(this.id, log)
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    packs.forEach(([taskId, result]) => {
      const project = this.ctx.getProjectByTaskId(taskId)

      result?.errors?.forEach((error) => {
        if (typeof error === 'object' && error) {
          error.stacks = parseErrorStacktrace(error, {
            getSourceMap: file => project.getBrowserSourceMapModuleById(file),
          })
        }
      })
    })

    this.rpc.onTaskUpdate(this.id, packs)
  }

  onFinished(files?: File[], errors?: unknown[]) {
    const collecting = this.isCollecting
    nextTick(() => {
      this.rpc.onFinished(this.id, files, errors, collecting)
    })
  }

  onCollected(files?: File[]) {
    this.rpc.onCollected(this.id, files, this.isCollecting)
  }

  onWatcherStart(files?: File[], errors?: unknown[]) {
    this.rpc.onWatcherStart(this.id, files, errors, this.isCollecting)
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.rpc.onWatcherRerun(this.id, files, trigger, this.isCollecting)
  }
}
