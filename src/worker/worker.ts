import v8 from 'node:v8'
import { WebSocket } from 'ws'
import { createWorkerRPC } from './rpc'
import type { WorkerRunnerOptions } from './types'
import { Vitest } from './vitest'
import { initVitest } from './init'
import { WorkerProcessEmitter, WorkerWSEventEmitter } from './emitter'

const emitter = process.env.VITEST_WS_ADDRESS
  ? new WorkerWSEventEmitter(new WebSocket(process.env.VITEST_WS_ADDRESS))
  : new WorkerProcessEmitter()

emitter.on('message', async function onMessage(message: any) {
  if (emitter.name === 'ws') {
    message = JSON.parse(message.toString())
  }

  if (message.type === 'init') {
    emitter.off('message', onMessage)
    const data = message as WorkerRunnerOptions

    try {
      const { reporter, vitest, configs, workspaceSource } = await initVitest(
        data.meta,
        data.debug
          ? {
              disableConsoleIntercept: true,
              fileParallelism: false,
              testTimeout: 0,
              hookTimeout: 0,
            }
          : {},
      )

      const rpc = createWorkerRPC(new Vitest(vitest, data.debug, data.astCollect), {
        on(listener) {
          emitter.on('message', listener)
        },
        post(message) {
          emitter.send(message)
        },
        serialize: v8.serialize,
        deserialize: v => v8.deserialize(Buffer.from(v) as any),
      })
      reporter.initRpc(rpc)
      emitter.ready(configs, workspaceSource)
    }
    catch (err: any) {
      emitter.error(err)
    }
  }
})
