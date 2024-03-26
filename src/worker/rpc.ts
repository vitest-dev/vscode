import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'
import { createWorkerMethods } from './actions'

export function createWorkerRPC(vitestById: Record<string, Vitest>, channel: ChannelOptions) {
  const rpc = createBirpc<BirpcEvents, BirpcMethods>(createWorkerMethods(vitestById), {
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
