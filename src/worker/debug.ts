import v8 from 'node:v8'
import { WebSocket } from 'ws'
import type { WorkerRunnerOptions } from './types'
import { initVitest } from './init'
import { Vitest } from './vitest'
import { createWorkerRPC } from './rpc'
import { WorkerWSEventEmitter } from './emitter'

const ws = new WebSocket(process.env.VITEST_WS_ADDRESS!)
const emitter = new WorkerWSEventEmitter(ws)

ws.on('message', async function onMessage(_data) {
  const message = JSON.parse(_data.toString())

  if (message.type !== 'init')
    return

  ws.off('message', onMessage)
  const data = message as WorkerRunnerOptions

  try {
    const pkg = data.meta

    const vitest = await initVitest(pkg, {
      fileParallelism: false,
    })

    const rpc = createWorkerRPC(new Vitest(vitest.vitest, true), {
      on(listener) {
        ws.on('message', listener)
      },
      post(message) {
        ws.send(message)
      },
      serialize: v8.serialize,
      deserialize: v => v8.deserialize(Buffer.from(v)),
    })
    vitest.reporter.initRpc(rpc)
    emitter.ready()
  }
  catch (err: any) {
    emitter.error(err)
  }
})
