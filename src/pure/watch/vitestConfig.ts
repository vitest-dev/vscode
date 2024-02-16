import { effect, reactive } from '@vue/reactivity'
import type { ResolvedConfig } from 'vitest'
import getPort from 'get-port'
import { log } from '../../log'
import type { VitestWorkspaceConfig } from '../../config'
import { getConfig } from '../../config'
import { execWithLog, sanitizeFilePath } from '../utils'
import { createClient } from './ws-client'

async function connectAndFetchConfig(
  { port, url = `ws://localhost:${port}/__vitest_api__`, reconnectInterval, reconnectTries }: {
    url?: string
    port: number
    reconnectInterval?: number
    reconnectTries?: number
  },
) {
  let onFailedConnection: (() => void) | undefined
  const client = createClient(url, {
    reactive: reactive as any,
    reconnectInterval,
    reconnectTries,
    onFailedConnection: () => onFailedConnection?.(),
  })

  return new Promise<ResolvedConfig>((resolve, reject) => {
    onFailedConnection = () => reject(new Error ('Unable to connect to Vitest API'))
    const handled = new WeakSet()
    effect(() => {
      const ws = client.ws
      if (!handled.has(ws)) {
        handled.add(ws)
        ws.addEventListener('open', () => {
          log.info('pure/WS Opened')
          client.rpc.getConfig().then((_config) => {
            client.dispose()
            resolve(_config)
          })
        })

        ws.addEventListener('error', (e) => {
          console.error('pure/WS ERROR ', e)
        })

        ws.addEventListener('close', () => {
          log.info('pure/WS Close')
        })
      }
    })
  })
}

export async function fetchVitestConfig(
  workspaceConfigs: VitestWorkspaceConfig[],
) {
  const port = await getPort()
  const workspace = workspaceConfigs.find(workspace =>
    workspace.isCompatible && !workspace.isDisabled && workspace.isUsingVitestForSure)
  if (!workspace)
    return
  const folder = workspace.workspace.uri.fsPath
  const childProcess = execWithLog(
    workspace.cmd,
    [...workspace.args, '--api.port', port.toString(), '--api.host', '127.0.0.1'],
    {
      cwd: sanitizeFilePath(folder),
      env: { ...process.env, ...getConfig(folder).env },
    },
  ).child
  const config = await connectAndFetchConfig({
    port,
    reconnectInterval: 500,
    reconnectTries: 20,
  })
  childProcess.kill()
  return config
}
