import v8 from 'node:v8'
import { register } from 'node:module'
import { WebSocket } from 'ws'
import type { WorkerRunnerOptions } from './types'
import { initVitest } from './init'
import { Vitest } from './vitest'
import { createWorkerRPC } from './rpc'
import { WorkerWSEventEmitter } from './emitter'

const _require = require

const ws = new WebSocket(process.env.VITEST_WS_ADDRESS!)
const emitter = new WorkerWSEventEmitter(ws)

ws.on('message', async function onMessage(_data) {
  const message = JSON.parse(_data.toString())

  if (message.type !== 'init')
    return

  ws.off('message', onMessage)
  const data = message as WorkerRunnerOptions

  try {
    if (data.meta.pnpApi) {
      _require(data.meta.pnpApi).setup()
    }

    if (data.meta.pnpLoader) {
      register(data.meta.pnpLoader)
    }

    const pkg = data.meta

    const vitest = await initVitest(pkg, {
      fileParallelism: false,
      testTimeout: Number.POSITIVE_INFINITY,
      hookTimeout: Number.POSITIVE_INFINITY,
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
