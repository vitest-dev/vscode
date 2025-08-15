import type { ChannelOptions } from 'birpc'
import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from 'vitest-vscode-shared'
import { createBirpc } from 'birpc'

export function createWorkerRPC(vitest: ExtensionWorkerTransport, channel: ChannelOptions) {
  const rpc = createBirpc<ExtensionWorkerEvents, ExtensionWorkerTransport>(vitest, {
    timeout: -1,
    bind: 'functions',
    eventNames: [
      'onConsoleLog',
      'onTaskUpdate',
      'onCollected',
      'onTestRunStart',
      'onTestRunEnd',
    ],
    ...channel,
  })
  return rpc
}
