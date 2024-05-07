import v8 from 'node:v8'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, TaskResultPack, UserConsoleLog } from 'vitest'

export interface VitestMethods {
  getFiles: () => Promise<[project: string, file: string][]>
  collectTests: (testFile: string[]) => Promise<void>
  cancelRun: () => Promise<void>
  runTests: (files?: string[], testNamePattern?: string) => Promise<void>
  updateSnapshots: (files?: string[], testNamePattern?: string) => Promise<void>

  watchTests: (files?: string[], testNamePattern?: string) => void
  unwatchTests: () => void

  enableCoverage: () => void
  disableCoverage: () => void
  waitForCoverageReport: () => Promise<string | null>
}

type VitestPoolMethods = {
  [K in keyof VitestMethods]: (id: string, ...args: Parameters<VitestMethods[K]>) => ReturnType<VitestMethods[K]>
}

export interface VitestPool extends VitestPoolMethods {
  close: () => void
}

export interface VitestEvents {
  onConsoleLog: (log: UserConsoleLog) => void
  onTaskUpdate: (task: TaskResultPack[]) => void
  onFinished: (files: File[], unhandledError: string, collecting?: boolean) => void
  onCollected: (files?: File[], collecting?: boolean) => void
  onWatcherStart: (files?: File[], errors?: unknown[], collecting?: boolean) => void
  onWatcherRerun: (files: string[], trigger?: string, collecting?: boolean) => void
}

export type BirpcEvents = {
  [K in keyof VitestEvents]: (folder: string, ...args: Parameters<VitestEvents[K]>) => void
}

export type VitestRPC = BirpcReturn<VitestPool, BirpcEvents>

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
    onConsoleLog: createHandler<BirpcEvents['onConsoleLog']>(),
    onTaskUpdate: createHandler<BirpcEvents['onTaskUpdate']>(),
    onFinished: createHandler<BirpcEvents['onFinished']>(),
    onCollected: createHandler<BirpcEvents['onCollected']>(),
    onWatcherRerun: createHandler<BirpcEvents['onWatcherRerun']>(),
    onWatcherStart: createHandler<BirpcEvents['onWatcherStart']>(),
  }

  const events: Omit<BirpcEvents, 'onReady' | 'onError'> = {
    onConsoleLog: handlers.onConsoleLog.trigger,
    onFinished: handlers.onFinished.trigger,
    onTaskUpdate: handlers.onTaskUpdate.trigger,
    onCollected: handlers.onCollected.trigger,
    onWatcherRerun: handlers.onWatcherRerun.trigger,
    onWatcherStart: handlers.onWatcherStart.trigger,
  }

  return {
    events,
    handlers: {
      onConsoleLog: handlers.onConsoleLog.register,
      onTaskUpdate: handlers.onTaskUpdate.register,
      onFinished: handlers.onFinished.register,
      onCollected: handlers.onCollected.register,
      onWatcherRerun: handlers.onWatcherRerun.register,
      onWatcherStart: handlers.onWatcherStart.register,
      removeListener(name: string, listener: any) {
        handlers[name as 'onCollected']?.remove(listener)
      },
      clearListeners() {
        for (const name in handlers)
          handlers[name as 'onCollected']?.clear()
      },
    },
  }
}

export function createVitestRpc(options: {
  on: (listener: (message: any) => void) => void
  send: (message: any) => void
}) {
  const { events, handlers } = createRpcOptions()

  const api = createBirpc<VitestPool, BirpcEvents>(
    events,
    {
      timeout: -1,
      on(listener) {
        options.on(listener)
      },
      post(message) {
        options.send(message)
      },
      serialize: v8.serialize,
      deserialize: v => v8.deserialize(Buffer.from(v)),
    },
  )

  return {
    api,
    handlers,
  }
}
