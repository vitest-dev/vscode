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

export async function createVitestAPI(workspace: vscode.WorkspaceFolder) {
  try {
    const root = workspace.uri.fsPath
    const vitestPath = require.resolve('vitest', { paths: [root] }) // resolves to cjs
    const vitestNodePath = resolve(dirname(vitestPath), './dist/node.js')
    log.info('[API]', 'Running Vitest from', vitestNodePath)
    const worker = new Worker(workerPath, {
      workerData: {
        root,
        vitestPath: vitestNodePath,
      },
    })
    worker.stdout.on('data', (d) => {
      log.info('[Worker]', d.toString())
    })
    worker.stderr.on('data', (d) => {
      log.error('[Worker]', d.toString())
    })

    return await new Promise<VitestAPI>((resolve, reject) => {
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
          onError(err) {
            reject(err)
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
  catch (err: any) {
    log.error('[API]', err?.stack)
    return null
  }
}
