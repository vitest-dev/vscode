import { parentPort, workerData } from 'node:worker_threads'

(async () => {
  parentPort!.postMessage({ msg: 'hello from worker', p: workerData.vitestPath })
  try {
    const vitestMode = await import(workerData.vitestPath) as typeof import('vitest/node')
    const vitest = await vitestMode.createVitest('test', {
      watch: false,
      root: workerData.root,
    })
    parentPort!.postMessage({ msg: 'vitest created' })
    const files = await vitest.globTestFiles()
    parentPort!.postMessage({
      files: files.map(([_, spec]) => spec),
    })
    await vitest.close()
  }
  catch (err) {
    parentPort!.postMessage({ error: err.message, stack: String(err.stack) })
  }
})()
