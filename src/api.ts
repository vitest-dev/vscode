import { Worker } from 'node:worker_threads'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, ResolvedConfig, TaskResultPack, UserConsoleLog } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

// import { getConfig, getRootConfig } from './config'

export interface BirpcMethods {
  getFiles: () => Promise<string[]>
  runFiles: (files?: string[], testNamePattern?: string) => Promise<void>
  getConfig: () => Promise<ResolvedConfig>
  isTestFile: (file: string) => Promise<boolean>
  terminate: () => void
}

export interface BirpcEvents {
  onReady: () => void
  onError: (err: object) => void

  onConsoleLog: (log: UserConsoleLog) => void
  onTaskUpdate: (task: TaskResultPack[]) => void
  onFinished: (files?: File[], errors?: unknown[]) => void
  onCollected: (files?: File[]) => void
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
    private rpc: VitestRPC,
    private handlers: ResolvedRPC['handlers'],
  ) {}

  getFiles() {
    return this.rpc.getFiles()
  }

  runFiles(files?: string[], testNamePattern?: string) {
    return this.rpc.runFiles(files, testNamePattern)
  }

  isTestFile(file: string) {
    return this.rpc.isTestFile(file)
  }

  dispose() {
    // TODO: terminate?
  }

  onConsoleLog(listener: BirpcEvents['onConsoleLog']) {
    this.handlers.onConsoleLog(listener)
  }

  onTaskUpdate(listener: BirpcEvents['onTaskUpdate']) {
    this.handlers.onTaskUpdate(listener)
  }

  onFinished(listener: BirpcEvents['onFinished']) {
    this.handlers.onFinished(listener)
  }

  onCollected(listener: BirpcEvents['onCollected']) {
    this.handlers.onCollected(listener)
  }

  clearListeners() {
    this.handlers.clearListeners()
  }
}

export async function resolveVitestAPI(folders: readonly vscode.WorkspaceFolder[]) {
  const apis = await Promise.all(folders.map(async (folder) => {
    const api = await createVitestRPC(folder)
    if (!api)
      return null
    return new VitestFolderAPI(folder, api.rpc, api.handlers)
  }))
  return new VitestAPI(apis.filter(x => x !== null) as VitestFolderAPI[])
}

interface ResolvedRPC {
  rpc: VitestRPC
  handlers: {
    onConsoleLog: (listener: BirpcEvents['onConsoleLog']) => void
    onTaskUpdate: (listener: BirpcEvents['onTaskUpdate']) => void
    onFinished: (listener: BirpcEvents['onFinished']) => void
    onCollected: (listener: BirpcEvents['onCollected']) => void
    clearListeners: () => void
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
  const onTaskUpdate: ((task: TaskResultPack[]) => void)[] = []
  const onFinished: ((files?: File[], errors?: unknown[]) => void)[] = []
  const onCollected: ((files?: File[]) => void)[] = []

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
              onTaskUpdate(listener) {
                onTaskUpdate.push(listener)
              },
              onFinished(listener) {
                onFinished.push(listener)
              },
              onCollected(listener) {
                onCollected.push(listener)
              },
              clearListeners() {
                logHandlers.length = 0
                onTaskUpdate.length = 0
                onFinished.length = 0
                onCollected.length = 0
              },
            },
          })
        },
        onError(err: any) {
          log.error('[API]', err?.stack)
          resolve(null)
        },
        onConsoleLog(log) {
          logHandlers.forEach(handler => handler(log))
        },
        onFinished(files, errors) {
          onFinished.forEach(handler => handler(files, errors))
        },
        onTaskUpdate(task) {
          onTaskUpdate.forEach(handler => handler(task))
        },
        onCollected(files) {
          onCollected.forEach(handler => handler(files))
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
