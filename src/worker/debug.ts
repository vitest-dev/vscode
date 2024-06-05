import v8 from 'node:v8'
import { WebSocket } from 'ws'
import type { WorkerRunnerOptions } from './types'
import { initVitest } from './init'
import { Vitest } from './vitest'
import { createWorkerRPC } from './rpc'

const ws = new WebSocket(process.env.VITEST_WS_ADDRESS!)

ws.on('message', async function init(_data) {
  const message = JSON.parse(_data.toString())
  if (message.type !== 'init')
    return
  ws.off('message', init)
  const data = message as WorkerRunnerOptions

  try {
    let vitest
    const pkg = data.meta

    try {
      vitest = await initVitest(pkg, {
        fileParallelism: false,
      })
    }
    catch (err: any) {
      ws.send(JSON.stringify({ type: 'error', errors: [pkg.id, err.stack] }))
      return
    }

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
    ws.send(JSON.stringify({ type: 'ready' }))
  }
  catch (err: any) {
    error(err)
  }
})

function error(err: any) {
  ws.send(JSON.stringify({
    type: 'error',
    errors: ['', String(err.stack)],
  }))
}
