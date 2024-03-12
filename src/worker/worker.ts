import v8 from 'node:v8'
import { register } from 'node:module'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { File, Reporter, TaskResultPack, UserConsoleLog, Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api'
import { createWorkerRPC } from './rpc'

interface VitestMeta {
  folder: string
  vitestNodePath: string
}

interface RunnerOptions {
  type: 'init'
  meta: VitestMeta[]
  loader?: string
}

class VSCodeReporter implements Reporter {
  private rpc!: BirpcReturn<BirpcEvents, BirpcMethods>
  private ctx!: Vitest
  private folder!: string

  initVitest(ctx: Vitest) {
    this.ctx = ctx
    this.folder = ctx.config.root
  }

  initRpc(rpc: BirpcReturn<BirpcEvents, BirpcMethods>) {
    this.rpc = rpc
  }

  onUserConsoleLog(log: UserConsoleLog) {
    this.rpc.onConsoleLog(this.folder, log)
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

    this.rpc.onTaskUpdate(this.folder, packs)
  }

  onFinished(files?: File[], errors?: unknown[]) {
    this.rpc.onFinished(this.folder, files, errors)
  }

  onCollected(files?: File[]) {
    this.rpc.onCollected(this.folder, files)
  }

  onWatcherStart(files?: File[], errors?: unknown[]) {
    this.rpc.onWatcherStart(this.folder, files, errors)
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.rpc.onWatcherRerun(this.folder, files, trigger)
  }
}

// TODO: run a sinlge Vitest instance if VitestNodePath is the same
async function initVitest(root: string, vitestNodePath: string) {
  const vitestMode = await import(vitestNodePath) as typeof import('vitest/node')
  const reporter = new VSCodeReporter()
  const vitest = await vitestMode.createVitest('test', {
    watch: true,
    api: false,
    root,
    reporters: [reporter],
  })
  reporter.initVitest(vitest)
  return {
    vitest,
    reporter,
  }
}

process.on('message', async function init(message: any) {
  if (message.type === 'init') {
    process.off('message', init)
    const data = message as RunnerOptions

    try {
      if (data.loader)
        register(data.loader)

      const vitest = await Promise.all(data.meta.map((meta) => {
        return initVitest(meta.folder, meta.vitestNodePath)
      }))
      const rpc = createWorkerRPC(vitest.map(v => v.vitest), {
        on(listener) {
          process.on('message', listener)
        },
        post(message) {
          process.send!(message)
        },
        serialize: v8.serialize,
        deserialize: v => v8.deserialize(Buffer.from(v)),
      })
      vitest.forEach(v => v.reporter.initRpc(rpc))
      process.send!({ type: 'ready' })
    }
    catch (err: any) {
      error(err)
    }
  }
})

function error(err: any) {
  process.send!({
    type: 'error',
    error: {
      message: err.message,
      stack: String(err.stack),
      name: err.name,
    },
  })
}

function _debug(...args: any[]) {
  process.send!({
    type: 'debug',
    args,
  })
}
