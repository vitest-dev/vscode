import v8 from 'node:v8'
import { register } from 'node:module'
import { createWorkerRPC } from './rpc'
import type { WorkerMeta, WorkerRunnerOptions } from './types'
import { VSCodeReporter } from './reporter'
import { Vitest } from './vitest'

async function initVitest(meta: WorkerMeta) {
  const vitestModule = await import(meta.vitestNodePath) as typeof import('vitest/node')
  const reporter = new VSCodeReporter(meta)
  const vitest = await vitestModule.createVitest(
    'test',
    {
      config: meta.configFile,
      workspace: meta.workspaceFile,
      root: meta.cwd,
      ...meta.arguments ? vitestModule.parseCLI(meta.arguments).options : {},
      watch: true,
      api: false,
      // @ts-expect-error private property
      reporter: undefined,
      reporters: [reporter],
      ui: false,
      includeTaskLocation: true,
    },
    {
      server: {
        middlewareMode: true,
      },
      plugins: [
        {
          name: 'vitest:vscode-extension',
          configResolved(config) {
            // stub a server so Vite doesn't start a websocket connection,
            // because we don't need it in the extension and it messes up Vite dev command
            config.server.hmr = {
              server: {
                on: () => {},
                off: () => {},
              } as any,
            }
          },
        },
      ],
    },
  )
  reporter.init(vitest)
  return {
    vitest,
    reporter,
    meta,
  }
}

const cwd = process.cwd()

process.on('message', async function init(message: any) {
  if (message.type === 'init') {
    process.off('message', init)
    const data = message as WorkerRunnerOptions

    try {
      if (data.loader)
        register(data.loader)
      const errors = []

      const vitest = []
      for (const meta of data.meta) {
        process.chdir(meta.cwd)
        try {
          vitest.push(await initVitest(meta))
        }
        catch (err: any) {
          errors.push([meta.id, err.stack])
        }
      }
      process.chdir(cwd)

      if (!vitest.length) {
        process.send!({ type: 'error', errors })
        return
      }

      const vitestById = Object.fromEntries(vitest.map(v =>
        [v.meta.id, new Vitest(v.meta.cwd, v.vitest)],
      ))
      const rpc = createWorkerRPC(vitestById, {
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
