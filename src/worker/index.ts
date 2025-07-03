import v8 from 'node:v8'
import { WebSocket } from 'ws'
import { createWorkerRPC } from './rpc'
import type { WorkerRunnerOptions } from './types'
import { initVitest } from './init'
import { WorkerWSEventEmitter } from './emitter'
import { ExtensionWorker } from './worker'

// this is the file that will be executed with "node <path>"

const emitter = new WorkerWSEventEmitter(
  new WebSocket(process.env.VITEST_WS_ADDRESS!),
)

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

      const rpc = createWorkerRPC(
        new ExtensionWorker(vitest, data.debug, data.astCollect),
        {
          on(listener) {
            emitter.on('message', listener)
          },
          post(message) {
            emitter.send(message)
          },
          serialize: v8.serialize,
          deserialize: v => v8.deserialize(Buffer.from(v) as any),
        },
      )
      const browserDebugOptions = vitest.projects.map(proj => ({ enabled: proj.config?.browser.enabled, provider: proj.config?.browser.provider, project: proj.getName() }))

      reporter.initRpc(rpc)
      emitter.ready(configs, workspaceSource, browserDebugOptions)
    }
    catch (err: any) {
      emitter.error(err)
    }
  }
})
