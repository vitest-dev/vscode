import v8 from 'node:v8'
import type { ChildProcess } from 'node:child_process'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, TaskResultPack, UserConsoleLog } from 'vitest'

export interface BirpcMethods {
  getFiles: (id: string) => Promise<[project: string, file: string][]>
  collectTests: (id: string, testFile: string) => Promise<void>
  cancelRun: (id: string) => Promise<void>
  runTests: (id: string, files?: string[], testNamePattern?: string) => Promise<void>
  isTestFile: (file: string) => Promise<boolean>

  watchTests: (id: string, files?: string[], testNamePattern?: string) => Promise<void>
  unwatchTests: (id: string) => Promise<void>

  startInspect: (port: number) => void
  stopInspect: () => void
  close: () => void
}

export interface VitestEvents {
  onConsoleLog: (log: UserConsoleLog) => void
  onTaskUpdate: (task: TaskResultPack[]) => void
  onFinished: (files?: File[], errors?: unknown[], collecting?: boolean) => void
  onCollected: (files?: File[], collecting?: boolean) => void
  onWatcherStart: (files?: File[], errors?: unknown[], collecting?: boolean) => void
  onWatcherRerun: (files: string[], trigger?: string, collecting?: boolean) => void
}

export type BirpcEvents = {
  [K in keyof VitestEvents]: (folder: string, ...args: Parameters<VitestEvents[K]>) => void
}

export type VitestRPC = BirpcReturn<BirpcMethods, BirpcEvents>

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

function createRpcOptions() {
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

export function createVitestRpc(vitest: ChildProcess) {
  const { events, handlers } = createRpcOptions()

  const api = createBirpc<BirpcMethods, BirpcEvents>(
    events,
    {
      timeout: -1,
      on(listener) {
        vitest.on('message', listener)
      },
      post(message) {
        vitest.send(message)
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
