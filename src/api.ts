import { Worker } from 'node:worker_threads'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { ResolvedConfig, UserConsoleLog } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

// import { getConfig, getRootConfig } from './config'

export interface BirpcMethods {
  getFiles: () => Promise<string[]>
  getConfig: () => Promise<ResolvedConfig>
  isTestFile: (file: string) => Promise<boolean>
  terminate: () => void
}

export interface BirpcEvents {
  onReady: () => void
  onError: (err: object) => void

  onConsoleLog: (log: UserConsoleLog) => void
}

type VitestRPC = BirpcReturn<BirpcMethods, BirpcEvents>

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

export class VitestAPI {
  constructor(
    private api: VitestFolderAPI[],
  ) {}

  get enabled() {
    return this.api.length > 0
  }

  map<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.map(callback)
  }

  async isTestFile(file: string) {
    for (const rpc of this.api) {
      if (await rpc.isTestFile(file))
        return true
    }
    return false
  }

  dispose() {
    // TODO: terminate?
  }
}

export class VitestFolderAPI {
  constructor(
    public folder: vscode.WorkspaceFolder,
    public api: ResolvedRPC,
  ) { }

  getFiles() {
    return this.api.rpc.getFiles()
  }

  isTestFile(file: string) {
    return this.api.rpc.isTestFile(file)
  }

  dispose() {
    // TODO: terminate?
  }

  onConsoleLog(listener: (log: UserConsoleLog) => void) {
    this.api.handlers.onConsoleLog(listener)
  }
}

export async function resolveVitestAPI(folders: readonly vscode.WorkspaceFolder[]) {
  const apis = await Promise.all(folders.map(async (folder) => {
    const api = await createVitestRPC(folder)
    if (!api)
      return null
    return new VitestFolderAPI(folder, api)
  }))
  return new VitestAPI(apis.filter(x => x !== null) as VitestFolderAPI[])
}

interface ResolvedRPC {
  rpc: VitestRPC
  handlers: {
    onConsoleLog: (listener: (log: UserConsoleLog) => void) => void
  }
}

export async function createVitestRPC(workspace: vscode.WorkspaceFolder) {
  // TODO: respect config? Why does enable exist? Can't you just disable the extension?
  // if (getConfig(workspace).enable === false || getRootConfig().disabledWorkspaceFolders.includes(workspace.name))
  //   return null
  // TODO: check compatibility with version >= 0.34.0(?)
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
  worker.stdout.on('data', d => log.info('[Worker]', d.toString()))
  worker.stderr.on('data', d => log.error('[Worker]', d.toString()))

  const logHandlers: ((log: UserConsoleLog) => void)[] = []

  return await new Promise<ResolvedRPC | null>((resolve) => {
    const api = createBirpc<BirpcMethods, BirpcEvents>(
      {
        onReady() {
          log.info('[API]', `Vitest for "${workspace.name}" workspace folder is resolved.`)
          resolve({
            rpc: api,
            handlers: {
              onConsoleLog(listener) {
                logHandlers.push(listener)
              },
            },
          })
        },
        onError(err: any) {
          log.error('[API]', err?.stack)
          resolve(null)
        },
        onConsoleLog(log) {
          for (const handler of logHandlers)
            handler(log)
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
