import WebSocket from 'ws'
import { computed, effect, reactive, ref, shallowRef } from '@vue/reactivity'
import type { ResolvedConfig, Task, TaskResult, WebSocketEvents } from 'vitest'
import { log } from '../../log'
import { createClient } from './ws-client'

type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED';
(globalThis as any).WebSocket = WebSocket
export type RunState = 'idle' | 'running'

export function buildWatchClient(
  { port, url = `ws://localhost:${port}/__vitest_api__`, handlers, reconnectInterval, reconnectTries }: {
    url?: string
    handlers?: Partial<WebSocketEvents>
    port: number
    reconnectInterval?: number
    reconnectTries?: number
  },
) {
  const client = createClient(url, {
    handlers,
    WebSocketConstructor: WebSocket as any,
    reactive: reactive as any,
    reconnectInterval,
    reconnectTries,
  })

  const config = shallowRef<ResolvedConfig>({} as any)
  const status = ref<WebSocketStatus>('CONNECTING')
  const files = computed(() => client.state.getFiles())

  const handled = new WeakSet()
  effect(() => {
    const ws = client.ws
    if (!handled.has(ws)) {
      handled.add(ws)
      status.value = 'CONNECTING'
      ws.addEventListener('open', () => {
        log.info('WS Opened')
        status.value = 'OPEN'
        client.state.filesMap.clear()
        client.rpc.getFiles().then((files) => {
          client.state.collectFiles(files)
          handlers?.onCollected?.(files)
        })
        client.rpc.getConfig().then(_config => config.value = _config)
      })

      ws.addEventListener('error', (e) => {
        console.error('WS ERROR', e)
      })

      ws.addEventListener('close', () => {
        log.info('WS Close')
        setTimeout(() => {
          if (status.value === 'CONNECTING')
            status.value = 'CLOSED'
        }, 1000)
      })
    }
  })

  // load result from first run manually
  // otherwise those record will not be recorded to client.state
  const loadingPromise = client.waitForConnection().then(async () => {
    const files = await client.rpc.getFiles()
    const idResultPairs: [string, TaskResult][] = []
    let isRunning = files.length === 0
    files && travel(files)
    function travel(tasks: Task[]) {
      for (const task of tasks) {
        if (task.type === 'test') {
          if (task.result)
            idResultPairs.push([task.id, task.result])
          else if (task.mode === 'run')
            isRunning = true
        }
        else {
          travel(task.tasks)
        }
      }
    }

    client.state.updateTasks(idResultPairs)
    return isRunning
  })

  return {
    client,
    config,
    status,
    files,
    loadingPromise,
  }
}
