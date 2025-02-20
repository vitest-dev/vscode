import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from '../api/rpc'
import type { ExtensionWorker } from './worker'

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
