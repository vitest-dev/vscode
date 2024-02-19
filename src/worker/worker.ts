import { workerData } from 'node:worker_threads'
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
