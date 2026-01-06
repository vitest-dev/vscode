import type { ExtensionWorkerEvents, ExtensionWorkerTransport } from 'vitest-vscode-shared'
import { stripVTControlCharacters } from 'node:util'
import v8 from 'node:v8'
import { createBirpc } from 'birpc'
import { log } from '../log'

export type {
  ExtensionWorkerEvents,
  ExtensionWorkerTransport,
  VitestExtensionRPC,
  VitestWorkerRPC,
} from 'vitest-vscode-shared'

function createHandler<T extends (...args: any) => any>() {
  const handlers: T[] = []
  return {
    handlers,
    register: (listener: any) => handlers.push(listener),
    trigger: (...data: any) => handlers.forEach(handler => handler(...data)),
    clear: () => handlers.length = 0,
    remove: (listener: T) => {
      const index = handlers.indexOf(listener)
      if (index !== -1)
        handlers.splice(index, 1)
    },
  }
}

export function createRpcOptions() {
  const handlers = {
    onConsoleLog: createHandler<ExtensionWorkerEvents['onConsoleLog']>(),
    onTaskUpdate: createHandler<ExtensionWorkerEvents['onTaskUpdate']>(),
    onCollected: createHandler<ExtensionWorkerEvents['onCollected']>(),
    onTestRunStart: createHandler<ExtensionWorkerEvents['onTestRunStart']>(),
    onTestRunEnd: createHandler<ExtensionWorkerEvents['onTestRunEnd']>(),
    onProcessLog: createHandler<ExtensionWorkerEvents['onProcessLog']>(),
  }

  const events: Omit<ExtensionWorkerEvents, 'onReady' | 'onError'> = {
    onConsoleLog: handlers.onConsoleLog.trigger,
    onTestRunEnd: handlers.onTestRunEnd.trigger,
    onTaskUpdate: handlers.onTaskUpdate.trigger,
    onCollected: handlers.onCollected.trigger,
    onTestRunStart: handlers.onTestRunStart.trigger,
    onProcessLog(type, message) {
      handlers.onProcessLog.trigger(type, message)
      log.worker(type === 'stderr' ? 'error' : 'info', stripVTControlCharacters(message))
    },
  }

  return {
    events,
    handlers: {
      onConsoleLog: handlers.onConsoleLog.register,
      onTaskUpdate: handlers.onTaskUpdate.register,
      onTestRunEnd: handlers.onTestRunEnd.register,
      onCollected: handlers.onCollected.register,
      onTestRunStart: handlers.onTestRunStart.register,
      onProcessLog: handlers.onProcessLog.register,
      removeListener(name: string, listener: any) {
        handlers[name as 'onCollected']?.remove(listener)
      },
      clearListeners() {
        // Clear all handlers except onProcessLog, which needs to persist
        // across test runs to forward stdout from Vitest to the extension
        handlers.onConsoleLog.clear()
        handlers.onTaskUpdate.clear()
        handlers.onCollected.clear()
        handlers.onTestRunStart.clear()
        handlers.onTestRunEnd.clear()
      },
    },
  }
}

export function createVitestRpc(options: {
  on: (listener: (message: any) => void) => void
  send: (message: any) => void
}) {
  const { events, handlers } = createRpcOptions()

  const api = createBirpc<ExtensionWorkerTransport, ExtensionWorkerEvents>(
    events,
    {
      timeout: -1,
      bind: 'functions',
      on(listener) {
        options.on(listener)
      },
      post(message) {
        options.send(message)
      },
      serialize: v8.serialize,
      deserialize: v => v8.deserialize(Buffer.from(v) as any),
    },
  )

  return {
    api,
    handlers,
  }
}
