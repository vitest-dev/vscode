import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { BirpcEvents, VitestPool } from '../api/rpc'
import { createVitestPool } from './pool'
import type { Vitest } from './vitest'

export function createWorkerRPC(vitestById: Record<string, Vitest>, channel: ChannelOptions) {
  const rpc = createBirpc<BirpcEvents, VitestPool>(createVitestPool(vitestById), {
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
