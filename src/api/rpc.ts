import v8 from 'node:v8'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { RunnerTestFile, TaskResultPack, UserConsoleLog } from 'vitest'

export type SerializedTestSpecification = [
  project: { name: string | undefined },
  file: string,
]

export interface VitestMethods {
  getFiles: () => Promise<[project: string, file: string][]>
  collectTests: (testFile: [project: string, filepath: string][]) => Promise<void>
  cancelRun: () => Promise<void>
  // accepts files with the project or folders (project doesn't matter for them)
  runTests: (files?: SerializedTestSpecification[] | string[], testNamePattern?: string) => Promise<void>
  updateSnapshots: (files?: SerializedTestSpecification[] | string[], testNamePattern?: string) => Promise<void>

  watchTests: (files?: SerializedTestSpecification[] | string[], testNamePattern?: string) => void
  unwatchTests: () => void

  invalidateIstanbulTestModules: (modules: string[] | null) => Promise<void>
  enableCoverage: () => void
  disableCoverage: () => void
  waitForCoverageReport: () => Promise<string | null>
  close: () => void

  onFilesCreated: (files: string[]) => void
  onFilesChanged: (files: string[]) => void
}

export interface VitestEvents {
  onConsoleLog: (log: UserConsoleLog) => void
  onTaskUpdate: (task: TaskResultPack[]) => void
  onFinished: (files: RunnerTestFile[], unhandledError: string, collecting?: boolean) => void
  onCollected: (files?: RunnerTestFile[], collecting?: boolean) => void
  onWatcherStart: (files?: RunnerTestFile[], errors?: unknown[], collecting?: boolean) => void
  onWatcherRerun: (files: string[], trigger?: string, collecting?: boolean) => void
}

export type VitestRPC = BirpcReturn<VitestMethods, VitestEvents>

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
    onConsoleLog: createHandler<VitestEvents['onConsoleLog']>(),
    onTaskUpdate: createHandler<VitestEvents['onTaskUpdate']>(),
    onFinished: createHandler<VitestEvents['onFinished']>(),
    onCollected: createHandler<VitestEvents['onCollected']>(),
    onWatcherRerun: createHandler<VitestEvents['onWatcherRerun']>(),
    onWatcherStart: createHandler<VitestEvents['onWatcherStart']>(),
  }

  const events: Omit<VitestEvents, 'onReady' | 'onError'> = {
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

  const api = createBirpc<VitestMethods, VitestEvents>(
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
