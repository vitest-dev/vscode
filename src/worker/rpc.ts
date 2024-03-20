import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'
import { createWorkerMethods } from './actions'

export function createWorkerRPC(vitest: Vitest[], channel: ChannelOptions) {
  const rpc = createBirpc<BirpcEvents, BirpcMethods>(createWorkerMethods(vitest), {
    timeout: -1,
    eventNames: [
      'onConsoleLog',
      'onTaskUpdate',
      'onFinished',
      'onCollected',
    ],
    ...channel,
  })
  return rpc
}
