import v8 from 'node:v8'
import { register } from 'node:module'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { File, Reporter, TaskResultPack, UserConsoleLog, Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'
import { createWorkerRPC } from './rpc'

interface VitestMeta {
  folder: string
  vitestNodePath: string
  id: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
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

async function initVitest(meta: VitestMeta) {
  const vitestMode = await import(meta.vitestNodePath) as typeof import('vitest/node')
  const reporter = new VSCodeReporter()
  const vitest = await vitestMode.createVitest(
    'test',
    {
      config: meta.configFile,
      workspace: meta.workspaceFile,
      watch: true,
      api: false,
      root: meta.folder,
      reporters: [reporter],
      ui: false,
      env: meta.env,
      includeTaskLocation: true,
    },
    {
      server: {
        middlewareMode: true,
      },
    },
  )
  reporter.initVitest(vitest)
  return {
    vitest,
    reporter,
  }
}

const cwd = process.cwd()

process.on('message', async function init(message: any) {
  _debug('onMessage', JSON.stringify(message));

  if (message.type === 'init') {
    process.off('message', init)
    const data = message as RunnerOptions

    try {
      if (data.loader)
        register(data.loader)
      const errors = []

      const vitest = []
      for (const meta of data.meta) {
        process.chdir(meta.folder)
        try {
          vitest.push(await initVitest(meta))
        }
        catch (err: any) {
          errors.push([meta.configFile, err.stack])
        }
      }
      process.chdir(cwd)

      if (!vitest.length) {
        process.send!({ type: 'error', errors })
        return
      }

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
      process.send!({ type: 'ready', errors })
    }
    catch (err: any) {
      error(err)
    }
  }
})

function error(err: any) {
  process.send!({
    type: 'error',
    errors: ['', String(err.stack)],
  })
}

function _debug(...args: any[]) {
  process.send!({
    type: 'debug',
    args,
  })
}
