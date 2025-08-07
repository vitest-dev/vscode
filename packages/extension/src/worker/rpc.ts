import type { ChannelOptions } from 'birpc'
import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from '../api/rpc'
import type { ExtensionWorker } from './worker'
import { createBirpc } from 'birpc'

export function createWorkerRPC(vitest: ExtensionWorker, channel: ChannelOptions) {
  const rpc = createBirpc<ExtensionWorkerEvents, ExtensionWorkerTransport>(vitest, {
    timeout: -1,
    bind: 'functions',
    eventNames: [
      'onConsoleLog',
      'onTaskUpdate',
      'onFinished',
      'onCollected',
      'onWatcherRerun',
      'onWatcherStart',
    ],
    ...channel,
  })
  return rpc
}
