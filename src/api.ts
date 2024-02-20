import { Worker } from 'node:worker_threads'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, ResolvedConfig, TaskResultPack, UserConsoleLog } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

const _require = require

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
  onWatcherStart: (files?: File[], errors?: unknown[]) => void
  onWatcherRerun: (files: string[], trigger?: string) => void
}

type VitestRPC = BirpcReturn<BirpcMethods, BirpcEvents>

function resolveVitestPackagePath(workspace: vscode.WorkspaceFolder) {
  try {
    return require.resolve('vitest/package.json', {
      paths: [workspace.uri.fsPath],
    })
  }
  catch (err: any) {
    log.info('[API]', `Vitest not found in "${workspace.name}" workspace folder`)
    return null
  }
}

function resolveVitestNodePath(vitestPkgPath: string) {
  return resolve(dirname(vitestPkgPath), './dist/node.js')
}

function resolveVitestPath(vitestPkgPath: string) {
  return resolve(dirname(vitestPkgPath), './dist/index.js')
}

export class VitestReporter {
  constructor(
    protected handlers: ResolvedRPC['handlers'],
  ) {}

  onConsoleLog = this.createHandler('onConsoleLog')
  onTaskUpdate = this.createHandler('onTaskUpdate')
  onFinished = this.createHandler('onFinished')
  onCollected = this.createHandler('onCollected')
  onWatcherStart = this.createHandler('onWatcherStart')
  onWatcherRerun = this.createHandler('onWatcherRerun')

  clearListeners() {
    this.handlers.clearListeners()
  }

  private createHandler<K extends Exclude<keyof ResolvedRPC['handlers'], 'clearListeners'>>(name: K) {
    return (callback: BirpcEvents[K]) => {
      this.handlers[name](callback as any)
    }
  }
}

export class VitestAPI {
  constructor(
    protected api: VitestFolderAPI[],
  ) {}

  get enabled() {
    return this.api.length > 0
  }

  map<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.map(callback)
  }

  forEach<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.forEach(callback)
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

export class VitestFolderAPI extends VitestReporter {
  constructor(
    public folder: vscode.WorkspaceFolder,
    private rpc: VitestRPC,
    handlers: ResolvedRPC['handlers'],
  ) {
    super(handlers)
  }

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
  version: string
  cli: string
  handlers: {
    onConsoleLog: (listener: BirpcEvents['onConsoleLog']) => void
    onTaskUpdate: (listener: BirpcEvents['onTaskUpdate']) => void
    onFinished: (listener: BirpcEvents['onFinished']) => void
    onCollected: (listener: BirpcEvents['onCollected']) => void
    onWatcherStart: (listener: BirpcEvents['onWatcherStart']) => void
    onWatcherRerun: (listener: BirpcEvents['onWatcherRerun']) => void
    clearListeners: () => void
  }
}

function createHandler<T extends (...args: any) => any>() {
  const handlers: T[] = []
  return {
    handlers,
    register: (listener: any) => handlers.push(listener),
    trigger: (data: any) => handlers.forEach(handler => handler(data)),
    clear: () => handlers.length = 0,
  }
}

export async function createVitestRPC(workspace: vscode.WorkspaceFolder) {
  // TODO: respect config? Why does enable exist? Can't you just disable the extension?
  // if (getConfig(workspace).enable === false || getRootConfig().disabledWorkspaceFolders.includes(workspace.name))
  //   return null
  // TODO: check compatibility with version >= 0.34.0(?)
  const vitestPackagePath = resolveVitestPackagePath(workspace)
  if (!vitestPackagePath)
    return null
  const pkg = _require(vitestPackagePath)
  const vitestNodePath = resolveVitestNodePath(vitestPackagePath)
  log.info('[API]', `Running Vitest ${pkg.version} for "${workspace.name}" workspace folder from ${vitestNodePath}`)
  const worker = new Worker(workerPath, {
    workerData: {
      root: workspace.uri.fsPath,
      vitestPath: vitestNodePath,
    },
    env: {
      VITEST_VSCODE: 'true',
    },
  })
  worker.stdout.on('data', d => log.info('[Worker]', d.toString()))
  worker.stderr.on('data', d => log.error('[Worker]', d.toString()))

  const onConsoleLog = createHandler<BirpcEvents['onConsoleLog']>()
  const onTaskUpdate = createHandler<BirpcEvents['onTaskUpdate']>()
  const onFinished = createHandler<BirpcEvents['onFinished']>()
  const onCollected = createHandler<BirpcEvents['onCollected']>()
  const onWatcherRerun = createHandler<BirpcEvents['onWatcherRerun']>()
  const onWatcherStart = createHandler<BirpcEvents['onWatcherStart']>()

  return await new Promise<ResolvedRPC | null>((resolve) => {
    const api = createBirpc<BirpcMethods, BirpcEvents>(
      {
        onReady() {
          log.info('[API]', `Vitest for "${workspace.name}" workspace folder is resolved.`)
          resolve({
            rpc: api,
            version: pkg.version,
            cli: resolveVitestPath(vitestPackagePath),
            handlers: {
              onConsoleLog: onConsoleLog.register,
              onTaskUpdate: onTaskUpdate.register,
              onFinished: onFinished.register,
              onCollected: onCollected.register,
              onWatcherRerun: onWatcherRerun.register,
              onWatcherStart: onWatcherStart.register,
              clearListeners() {
                onConsoleLog.clear()
                onTaskUpdate.clear()
                onFinished.clear()
                onCollected.clear()
                onWatcherRerun.clear()
                onWatcherStart.clear()
              },
            },
          })
        },
        onError(err: any) {
          log.error('[API]', err?.stack)
          resolve(null)
        },
        onConsoleLog: onConsoleLog.trigger,
        onFinished: onFinished.trigger,
        onTaskUpdate: onTaskUpdate.trigger,
        onCollected: onCollected.trigger,
        onWatcherRerun: onWatcherRerun.trigger,
        onWatcherStart: onWatcherStart.trigger,
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
