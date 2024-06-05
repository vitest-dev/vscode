import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { VitestEvents, VitestMethods } from '../api/rpc'
import type { Vitest } from './vitest'

export function createWorkerRPC(vitest: Vitest, channel: ChannelOptions) {
  const rpc = createBirpc<VitestEvents, VitestMethods>(vitest, {
    timeout: -1,
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
