import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import v8 from 'node:v8'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, ResolvedConfig, TaskResultPack, UserConsoleLog } from 'vitest'
import { log } from './log'
import type { DebugSessionAPI } from './debug/startSession'
import { workerPath } from './constants'

const _require = require

// import { getConfig, getRootConfig } from './config'

export interface BirpcMethods {
  getFiles: () => Promise<string[]>
  runFiles: (files?: string[], testNamePattern?: string) => Promise<void>
  getConfig: () => Promise<ResolvedConfig>
  isTestFile: (file: string) => Promise<boolean>
  terminate: () => void

  startDebugger: (port: number) => void
  stopDebugger: () => void
}

export interface BirpcEvents {
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

  get length() {
    return this.api.length
  }

  get(folder: vscode.WorkspaceFolder) {
    return this.api.find(api => api.folder === folder)!
  }

  filter(callback: (api: VitestFolderAPI, index: number) => boolean) {
    return this.api.filter(callback)
  }

  map<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.map(callback)
  }

  forEach<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.forEach(callback)
  }

  async getTestFileData(file: string) {
    for (const rpc of this.api) {
      if (await rpc.isTestFile(file)) {
        return {
          folder: rpc.folder,
        }
      }
    }
    return null
  }

  dispose() {
    // TODO: terminate?
  }
}

const WEAKMAP_API_FOLDER = new WeakMap<VitestFolderAPI, vscode.WorkspaceFolder>()

export class VitestFolderAPI extends VitestReporter {
  constructor(
    folder: vscode.WorkspaceFolder,
    private rpc: VitestRPC,
    handlers: ResolvedRPC['handlers'],
    private pid: number,
    private debug?: DebugSessionAPI,
  ) {
    super(handlers)
    WEAKMAP_API_FOLDER.set(this, folder)
  }

  get folder() {
    return WEAKMAP_API_FOLDER.get(this)!
  }

  get processId() {
    return this.pid
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

  stopDebugger() {
    return this.rpc.stopDebugger()
  }

  startDebugger(port: number) {
    return this.rpc.startDebugger(port)
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
    return new VitestFolderAPI(folder, api.rpc, api.handlers, api.pid)
  }))
  return new VitestAPI(apis.filter(x => x !== null) as VitestFolderAPI[])
}

interface ResolvedRPC {
  rpc: VitestRPC
  version: string
  pid: number
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

function createRpcOptions() {
  const onConsoleLog = createHandler<BirpcEvents['onConsoleLog']>()
  const onTaskUpdate = createHandler<BirpcEvents['onTaskUpdate']>()
  const onFinished = createHandler<BirpcEvents['onFinished']>()
  const onCollected = createHandler<BirpcEvents['onCollected']>()
  const onWatcherRerun = createHandler<BirpcEvents['onWatcherRerun']>()
  const onWatcherStart = createHandler<BirpcEvents['onWatcherStart']>()

  const events: Omit<BirpcEvents, 'onReady' | 'onError'> = {
    onConsoleLog: onConsoleLog.trigger,
    onFinished: onFinished.trigger,
    onTaskUpdate: onTaskUpdate.trigger,
    onCollected: onCollected.trigger,
    onWatcherRerun: onWatcherRerun.trigger,
    onWatcherStart: onWatcherStart.trigger,
  }

  return {
    events,
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
    // on(listener: (data: string) => void) {
    //   ws.on('message', listener)
    // },
    // post(message: string) {
    //   ws.send(message)
    // },
  }
}

function createChildVitestProcess(
  folder: vscode.WorkspaceFolder,
  vitestNodePath: string,
) {
  const vitest = fork(
    workerPath,
    {
      cwd: folder.uri.fsPath,
      // TODO: use another execPath to use the local node version (also expose an option?)
      env: {
        VITEST_VSCODE: 'true',
      },
      stdio: 'overlapped',
    },
  )
  return new Promise<ChildProcess>((resolve, reject) => {
    vitest.on('error', (error) => {
      log.error('[API]', error)
      reject(error)
    })
    vitest.on('spawn', () => {
      vitest.send({ type: 'init', vitestPath: vitestNodePath })
      vitest.on('message', function ready(message: any) {
        if (message.type === 'ready') {
          vitest.off('message', ready)
          resolve(vitest)
        }
        if (message.type === 'error') {
          vitest.off('message', ready)
          reject(message.error)
        }
      })
    })
  })
}

export async function createVitestRPC(workspace: vscode.WorkspaceFolder): Promise<ResolvedRPC | null> {
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

  const vitest = await createChildVitestProcess(workspace, vitestNodePath)

  log.info('[Worker]', `Vitest process ${vitest.pid} created`)

  vitest.stdout?.on('data', d => log.info('[Worker]', d.toString()))
  vitest.stderr?.on('data', d => log.error('[Worker]', d.toString()))

  const { events, handlers } = createRpcOptions()

  const api = createBirpc<BirpcMethods, BirpcEvents>(
    events,
    {
      on(listener) {
        vitest.on('message', listener)
      },
      post(message) {
        vitest.send(message)
      },
      serialize: v8.serialize,
      deserialize: v => v8.deserialize(Buffer.from(v)),
    },
  )

  return {
    rpc: api,
    pid: vitest.pid!,
    version: pkg.version,
    handlers,
  }
}
