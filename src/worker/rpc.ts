import { parentPort } from 'node:worker_threads'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api'

export function createWorkerRPC(vitest: Vitest) {
  return createBirpc<BirpcEvents, BirpcMethods>({
    async getFiles() {
      const files = await vitest.globTestFiles()
      return files.map(([_, spec]) => spec)
    },
    async getConfig() {
      const config = vitest.getCoreWorkspaceProject().getSerializableConfig()
      return config
    },
    async terminate() {
      await vitest.close()
    },
  }, {
    eventNames: ['onReady', 'onError'],
    on(listener) {
      parentPort!.on('message', listener)
    },
    post(message) {
      parentPort!.postMessage(message)
    },
  })
}

export function createErrorRPC() {
  return createBirpc<BirpcEvents>({}, {
    eventNames: ['onError'],
    on(listener) {
      parentPort!.on('message', listener)
    },
    post(message) {
      parentPort!.postMessage(message)
    },
  })
}
