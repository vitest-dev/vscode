import type { WorkerRunnerOptions } from 'vitest-vscode-shared'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import v8 from 'node:v8'
import { createWorkerRPC, normalizeDriveLetter, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import { WebSocket } from 'ws'

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
      const vitestModule = await import(
        pathToFileURL(normalizeDriveLetter(data.meta.vitestNodePath)).toString()
      ) as typeof import('vitest/node')

      const isOld = Number(vitestModule.version[0]) < 4
      const workerName = isOld ? './workerOld.js' : './workerNew.js'
      const workerPath = pathToFileURL(join(__dirname, workerName))
      const initModule = await import(workerPath.toString())

      const { createWorker, reporter, configs, workspaceSource } = await initModule.initVitest(
        vitestModule,
        data,
        emitter,
      )

      const worker = createWorker()

      const rpc = createWorkerRPC(
        worker,
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
      worker.initRpc(rpc)
      reporter.initRpc(rpc)
      emitter.ready(configs, workspaceSource)
    }
    catch (err: any) {
      emitter.error(err)
    }
  }
})
