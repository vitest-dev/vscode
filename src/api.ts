import { Worker } from 'node:worker_threads'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { ResolvedConfig } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

export interface BirpcMethods {
  getFiles: () => Promise<string[]>
  getConfig: () => Promise<ResolvedConfig>
  terminate: () => void
}

export interface BirpcEvents {
  onReady: () => void
  onError: (err: object) => void
}

type VitestAPI = BirpcReturn<BirpcMethods, BirpcEvents>

function resolveVitestPath(workspace: vscode.WorkspaceFolder) {
  try {
    // resolves to unsupported cjs
    const vitestPath = require.resolve('vitest', { paths: [workspace.uri.fsPath] })
    return resolve(dirname(vitestPath), './dist/node.js')
  }
  catch (err: any) {
    log.info('[API]', `Vitest not found in "${workspace.name}" workspace folder`)
    return null
  }
}

export async function createVitestAPI(workspace: vscode.WorkspaceFolder) {
  const vitestNodePath = resolveVitestPath(workspace)
  if (!vitestNodePath)
    return null
  log.info('[API]', `Running Vitest for "${workspace.name}" workspace folder from ${vitestNodePath}`)
  const worker = new Worker(workerPath, {
    workerData: {
      root: workspace.uri.fsPath,
      vitestPath: vitestNodePath,
    },
  })
  worker.stdout.on('data', (d) => {
    log.info('[Worker]', d.toString())
  })
  worker.stderr.on('data', (d) => {
    log.error('[Worker]', d.toString())
  })

  return await new Promise<VitestAPI | null>((resolve) => {
    const api = createBirpc<BirpcMethods, BirpcEvents>(
      {
        onReady() {
          log.info('[API]', `Vitest for "${workspace.name}" workspace folder is resolved.`)
          resolve(new Proxy(api, {
            get(target, prop, receiver) {
              if (prop === 'then')
                return undefined
              return Reflect.get(target, prop, receiver)
            },
          }))
        },
        onError(err: any) {
          log.error('[API]', err?.stack)
          resolve(null)
        },
      },
      {
        on(listener) {
          worker.on('message', listener)
        },
        post(message) {
          worker.postMessage(message)
        },
      },
    )
  })
}
