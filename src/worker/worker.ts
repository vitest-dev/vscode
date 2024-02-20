import { workerData } from 'node:worker_threads'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import type { BirpcReturn } from 'birpc'
import type { BirpcEvents, BirpcMethods } from '../api'
import { createErrorRPC, createWorkerRPC } from './rpc'

(async () => {
  try {
    let rpc: BirpcReturn<BirpcEvents, BirpcMethods>
    const vitestMode = await import(workerData.vitestPath) as typeof import('vitest/node')
    const vitest = await vitestMode.createVitest('test', {
      watch: true,
      root: workerData.root,
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
    rpc = createWorkerRPC(vitest)
    await rpc.onReady()
  }
  catch (err: any) {
    const closeRpc = createErrorRPC()
    closeRpc.onError({
      message: err.message,
      stack: String(err.stack),
      name: err.name,
    })
  }
})()
