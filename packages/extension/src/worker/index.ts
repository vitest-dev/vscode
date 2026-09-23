import type { WorkerRunnerOptions } from 'vitest-vscode-shared'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWorkerRPC, normalizeDriveLetter, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import { WebSocket } from 'ws'
import { createRpcCodec, pickRpcCodec, v8FormatVersion } from '../rpcCodec'

// this is the file that will be executed with "node <path>"

const emitter = new WorkerWSEventEmitter(new WebSocket(process.env.VITEST_WS_ADDRESS!))

process.title = 'vitest-vscode'

if (process.platform === 'win32') {
  const cwd = process.cwd()
  const correctCwd = cwd.slice(0, 1).toUpperCase() + cwd.slice(1)
  if (correctCwd !== cwd) {
    process.chdir(correctCwd)
  }
}

emitter.on('message', async function onMessage(message: any) {
  if (emitter.name === 'ws') {
    message = JSON.parse(message.toString())
  }

  if (message.type === 'init') {
    emitter.off('message', onMessage)
    const data = message as WorkerRunnerOptions

    try {
      const vitestModule = (await import(
        pathToFileURL(normalizeDriveLetter(data.meta.vitestNodePath)).toString()
      )) as typeof import('vitest/node')

      const isLegacy = !vitestModule.version || Number(vitestModule.version[0]) < 4
      const workerName = isLegacy ? './workerLegacy.js' : './workerNew.js'
      const workerPath = pathToFileURL(join(__dirname, workerName))
      const initModule = await import(workerPath.toString())

      const { createWorker, metadata, reporter } = await initModule.initVitest(
        vitestModule,
        data,
        emitter,
      )

      const worker = createWorker()

      const codec = pickRpcCodec(data.meta.runtime, data.meta.v8FormatVersion, v8FormatVersion())
      const rpc = createWorkerRPC(worker, {
        on(listener) {
          emitter.on('message', listener)
        },
        post(message) {
          emitter.send(message)
        },
        ...createRpcCodec(codec),
      })
      worker.initRpc(rpc)
      reporter.initRpc(rpc)
      emitter.ready(metadata, isLegacy, vitestModule.version, codec)

      await worker.vitest.report('onInit', worker.vitest)
    } catch (err: any) {
      emitter.error(err)
    }
  }
})
