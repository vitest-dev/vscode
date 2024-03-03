import v8 from 'node:v8'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { BirpcEvents, BirpcMethods } from '../api'
import { createWorkerRPC } from './rpc'

interface RunnerOptions {
  vitestPath: string
}

async function initVitest(options: RunnerOptions) {
  try {
    let rpc: BirpcReturn<BirpcEvents, BirpcMethods>
    const vitestMode = await import(options.vitestPath) as typeof import('vitest/node')
    const vitest = await vitestMode.createVitest('test', {
      watch: true,
      root: process.cwd(),
      reporters: [
        {
          onUserConsoleLog(log) {
            rpc.onConsoleLog(log)
          },
          onTaskUpdate(packs) {
            packs.forEach(([taskId, result]) => {
              const project = vitest.getProjectByTaskId(taskId)

              result?.errors?.forEach((error) => {
                if (typeof error === 'object' && error) {
                  error.stacks = parseErrorStacktrace(error, {
                    getSourceMap: file => project.getBrowserSourceMapModuleById(file),
                  })
                }
              })
            })

            rpc.onTaskUpdate(packs)
          },
          onFinished(files, errors) {
            rpc.onFinished(files, errors)
          },
          onCollected(files) {
            rpc.onCollected(files)
          },
          onWatcherStart(files, errors) {
            rpc.onWatcherStart(files, errors)
          },
          onWatcherRerun(files, trigger) {
            rpc.onWatcherRerun(files, trigger)
          },
        },
      ],
    })
    rpc = createWorkerRPC(vitest, {
      on(listener) {
        process.on('message', listener)
      },
      post(message) {
        process.send!(message)
      },
      serialize: v8.serialize,
      deserialize: v => v8.deserialize(Buffer.from(v)),
    })
    process.send!({ type: 'ready' })
  }
  catch (err: any) {
    process.send!({
      type: 'error',
      error: {
        message: err.message,
        stack: String(err.stack),
        name: err.name,
      },
    })
  }
}

process.on('message', function init(message: any) {
  if (message.type === 'init') {
    process.off('message', init)
    initVitest(message)
  }
})
