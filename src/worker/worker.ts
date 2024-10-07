import v8 from 'node:v8'
import { createWorkerRPC } from './rpc'
import type { WorkerRunnerOptions } from './types'
import { Vitest } from './vitest'
import { initVitest } from './init'
import { WorkerProcessEmitter } from './emitter'

const emitter = new WorkerProcessEmitter()

process.on('message', async function onMessage(message: any) {
  if (message.type === 'init') {
    process.off('message', onMessage)
    const data = message as WorkerRunnerOptions

    try {
      const { reporter, vitest } = await initVitest(data.meta)

      const rpc = createWorkerRPC(new Vitest(vitest), {
        on(listener) {
          process.on('message', listener)
        },
        post(message) {
          process.send!(message)
        },
        serialize: v8.serialize,
        deserialize: v => v8.deserialize(Buffer.from(v) as any),
      })
      reporter.initRpc(rpc)
      emitter.ready()
    }
    catch (err: any) {
      emitter.error(err)
    }
  }
})
