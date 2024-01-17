// this file is copied from vitest with a few modifications;
// it should be patched back to the original files
import { shallowReactive } from '@vue/reactivity'
import type { BirpcReturn } from 'birpc'
import { createBirpc } from 'birpc'
import { parse, stringify } from 'flatted'
// eslint-disable-next-line no-restricted-imports
import type {
  File,
  Task,
  TaskResultPack,
  UserConsoleLog, WebSocketEvents, WebSocketHandlers,
} from 'vitest'
import { log } from '../../log'

class StateManager {
  filesMap = new Map<string, File>()
  idMap = new Map<string, Task>()
  taskFileMap = new WeakMap<Task, File>()
  errorsSet = new Set<unknown>()

  catchError(err: unknown, type: string) {
    (err as any).type = type
    this.errorsSet.add(err)
  }

  clearErrors() {
    this.errorsSet.clear()
  }

  getUnhandledErrors() {
    return Array.from(this.errorsSet.values())
  }

  getFiles(keys?: string[]): File[] {
    if (keys)
      return keys.map(key => this.filesMap.get(key)!)

    return Array.from(this.filesMap.values())
  }

  getFilepaths(): string[] {
    return Array.from(this.filesMap.keys())
  }

  getFailedFilepaths() {
    return this.getFiles()
      .filter(i => i.result?.state === 'fail')
      .map(i => i.filepath)
  }

  collectFiles(files: File[] = []) {
    files.forEach((file) => {
      this.filesMap.set(file.filepath, file)
      this.updateId(file)
    })
  }

  updateId(task: Task) {
    if (this.idMap.get(task.id) === task)
      return

    this.idMap.set(task.id, task)
    if (task.type === 'suite') {
      task.tasks.forEach((task) => {
        this.updateId(task)
      })
    }
  }

  updateTasks(packs: TaskResultPack[]) {
    for (const [id, result] of packs) {
      if (this.idMap.has(id))
        this.idMap.get(id)!.result = result
    }
  }

  updateUserLog(log: UserConsoleLog) {
    const task = log.taskId && this.idMap.get(log.taskId)
    if (task) {
      if (!task.logs)
        task.logs = []

      task.logs.push(log)
    }
  }
}
export interface VitestClientOptions {
  handlers?: Partial<WebSocketEvents>
  autoReconnect?: boolean
  reconnectInterval?: number
  reconnectTries?: number
  reactive?: <T>(v: T) => T
  ref?: <T>(v: T) => { value: T }
  WebSocketConstructor?: typeof WebSocket
  onFailedConnection?: () => void
}

export interface VitestClient {
  ws: WebSocket
  state: StateManager
  rpc: BirpcReturn<WebSocketHandlers, WebSocketEvents>
  waitForConnection(): Promise<void>
  reconnect(): Promise<void>
  dispose(): void
}

export function createClient(url: string, options: VitestClientOptions = {}) {
  const {
    handlers = {},
    autoReconnect = true,
    reconnectInterval = 2000,
    reconnectTries = 10,
    reactive = v => v,
    WebSocketConstructor = globalThis.WebSocket,
    onFailedConnection,
  } = options

  let tries = reconnectTries
  const ctx = reactive({
    ws: shallowReactive(new WebSocketConstructor(url)),
    state: new StateManager(),
    waitForConnection,
    reconnect: () => reconnect(true),
    dispose: () => {
      tries = 0
      ctx.ws.close()
    },
  }) as VitestClient

  ctx.state.filesMap = reactive(ctx.state.filesMap)
  ctx.state.idMap = reactive(ctx.state.idMap)

  let onMessage: Function
  ctx.rpc = createBirpc<WebSocketHandlers, WebSocketEvents>(
    {
      onCollected(files) {
        ctx.state.collectFiles(files)
        handlers.onCollected?.(files)
      },
      onCancel(reason) {
        handlers.onCancel?.(reason)
      },
      onTaskUpdate(packs) {
        ctx.state.updateTasks(packs)
        handlers.onTaskUpdate?.(packs)
      },
      onUserConsoleLog(log) {
        ctx.state.updateUserLog(log)
      },
      onFinished(files) {
        handlers.onFinished?.(files)
      },
    },
    {
      post: msg => ctx.ws.send(msg),
      on: fn => onMessage = fn,
      serialize: stringify,
      deserialize: parse,
    },
  )

  let openResolve: () => void
  let openPromise: Promise<void> = new Promise((resolve) => {
    openResolve = resolve
  })

  let opened = false
  function reconnect(reset = false) {
    if (reset) {
      opened = false
      tries = reconnectTries
      openPromise = new Promise((resolve) => {
        openResolve = resolve
      })
    }

    if (opened)
      return

    log.info('RECONNECT')
    ctx.ws = shallowReactive(new WebSocketConstructor(url))
    registerWS()
  }

  function registerWS() {
    ctx.ws.addEventListener('open', () => {
      tries = reconnectTries
      openResolve()
    })
    ctx.ws.addEventListener('message', (v) => {
      onMessage(v.data)
    })
    ctx.ws.addEventListener('close', () => {
      tries -= 1
      if (!opened && autoReconnect && tries > 0)
        setTimeout(reconnect, reconnectInterval)
      else if (autoReconnect && tries === 0)
        onFailedConnection?.()
    })
  }

  registerWS()

  function waitForConnection() {
    return openPromise
  }

  return ctx
}
