import WebSocket from 'ws'
import { computed, effect, reactive, ref, shallowRef } from '@vue/reactivity'
import type { ResolvedConfig, Task, TaskResult, WebSocketEvents } from 'vitest'
import { createClient } from './ws-client'

type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED';
(globalThis as any).WebSocket = WebSocket
export type RunState = 'idle' | 'running'

export function buildWatchClient(
  { port, url = `ws://localhost:${port}/__vitest_api__`, handlers }: {
    url?: string
    handlers?: Partial<WebSocketEvents>
    port: number
  },
) {
  const client = createClient(url, {
    handlers,
    WebSocketConstructor: WebSocket as any,
    reactive: reactive as any,
  })

  const config = shallowRef<ResolvedConfig>({} as any)
  const status = ref<WebSocketStatus>('CONNECTING')
  const files = computed(() => client.state.getFiles())

  effect(() => {
    const ws = client.ws
    status.value = 'CONNECTING'
    ws.addEventListener('open', () => {
      console.log('WS Opened')
      status.value = 'OPEN'
      client.state.filesMap.clear()
      client.rpc.getFiles().then(files => client.state.collectFiles(files))
      client.rpc.getConfig().then(_config => config.value = _config)
    })

    ws.addEventListener('error', (e) => {
      console.error('WS ERROR', e)
    })

    ws.addEventListener('close', () => {
      console.log('WS Close')
      setTimeout(() => {
        if (status.value === 'CONNECTING')
          status.value = 'CLOSED'
      }, 1000)
    })
  })

  // load result from first run manually
  // otherwise those record will not be recorded to client.state
  const loadingPromise = client.waitForConnection().then(async () => {
    const files = await client.rpc.getFiles()
    const idResultPairs: [string, TaskResult][] = []
    files && travel(files)
    function travel(tasks: Task[]) {
      for (const task of tasks) {
        if (task.type === 'test') {
          if (task.result)
            idResultPairs.push([task.id, task.result])
        }
        else {
          travel(task.tasks)
        }
      }
    }

    client.state.updateTasks(idResultPairs)
  })

  return {
    client,
    config,
    status,
    files,
    loadingPromise,
  }
}
