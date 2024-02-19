import { workerData } from 'node:worker_threads'
import { createErrorRPC, createWorkerRPC } from './rpc'

(async () => {
  try {
    const vitestMode = await import(workerData.vitestPath) as typeof import('vitest/node')
    const vitest = await vitestMode.createVitest('test', {
      watch: true,
      root: workerData.root,
    })
    const rpc = createWorkerRPC(vitest)
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
