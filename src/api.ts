import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import v8 from 'node:v8'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, TaskResultPack, UserConsoleLog } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

const _require = require

// import { getConfig, getRootConfig } from './config'

export interface BirpcMethods {
  getFiles: () => Promise<Record<string, string[]>>
  runFiles: () => Promise<void>
  cancelRun: () => Promise<void>
  runFolderFiles: (folder: string, files?: string[], testNamePattern?: string) => Promise<void>
  getTestMetadata: (file: string) => Promise<{
    folder: string
  } | null>

  startInspect: (port: number) => void
  stopInspect: () => void
}

export interface BirpcEvents {
  onConsoleLog: (folder: string, log: UserConsoleLog) => void
  onTaskUpdate: (folder: string, task: TaskResultPack[]) => void
  onFinished: (folder: string, files?: File[], errors?: unknown[]) => void
  onCollected: (folder: string, files?: File[]) => void
  onWatcherStart: (folder: string, files?: File[], errors?: unknown[]) => void
  onWatcherRerun: (folder: string, files: string[], trigger?: string) => void
}

export interface VitestEvents {
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
    protected folderFsPath: string,
    protected handlers: ResolvedMeta['handlers'],
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

  private createHandler<K extends Exclude<keyof ResolvedMeta['handlers'], 'clearListeners'>>(name: K) {
    return (callback: VitestEvents[K]) => {
      this.handlers[name]((folder, ...args) => {
        if (folder === this.folderFsPath)
          (callback as any)(...args)
      })
    }
  }
}

export class VitestAPI {
  constructor(
    protected api: VitestFolderAPI[],
    protected meta: ResolvedMeta,
  ) {}

  get enabled() {
    return this.api.length > 0
  }

  get processId() {
    return this.meta
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

  cancelRun() {
    return this.meta.rpc.cancelRun()
  }

  getFiles() {
    return this.meta.rpc.getFiles()
  }

  async runFiles() {
    await this.meta.rpc.runFiles()
  }

  stopInspect() {
    return this.meta.rpc.stopInspect()
  }

  startInspect(port: number) {
    return this.meta.rpc.startInspect(port)
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
    handlers: ResolvedMeta['handlers'],
  ) {
    super(folder.uri.fsPath, handlers)
    WEAKMAP_API_FOLDER.set(this, folder)
  }

  get folder() {
    return WEAKMAP_API_FOLDER.get(this)!
  }

  isTestFile(file: string) {
    return this.rpc.getTestMetadata(file)
  }

  async runFiles(files?: string[], testNamePatern?: string) {
    await this.rpc.runFolderFiles(this.folder.uri.fsPath, files, testNamePatern)
  }

  dispose() {
    // TODO: terminate?
  }
}

export async function resolveVitestAPI(folders: readonly vscode.WorkspaceFolder[]) {
  const vitest = await createVitestProcess(folders)
  if (!vitest)
    return null
  const apis = folders.map(folder =>
    new VitestFolderAPI(folder, vitest.rpc, vitest.handlers),
  )
  return new VitestAPI(apis, vitest)
}

interface ResolvedMeta {
  rpc: VitestRPC
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
  }
}

function nonNullable<T>(value: T | null | undefined): value is T {
  return value != null
}

interface VitestMeta {
  folder: vscode.WorkspaceFolder
  vitestNodePath: string
  version: string
}

function resolveVitestFoldersMeta(folders: readonly vscode.WorkspaceFolder[]): VitestMeta[] {
  return folders.map((folder) => {
    const vitestPackagePath = resolveVitestPackagePath(folder)
    if (!vitestPackagePath)
      return null
    const pkg = _require(vitestPackagePath)
    const vitestNodePath = resolveVitestNodePath(vitestPackagePath)
    return { folder, vitestNodePath, version: pkg.version }
  }).filter(nonNullable)
}

function createChildVitestProcess(meta: VitestMeta[]) {
  const vitest = fork(
    workerPath,
    {
      // TODO: use user's execPath to use the local node version (also expose an option?)
      execPath: undefined,
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
      vitest.send({
        type: 'init',
        meta: meta.map(m => ({
          vitestNodePath: m.vitestNodePath,
          folder: m.folder.uri.fsPath,
        })),
      })
    })
  })
}

export async function createVitestProcess(folders: readonly vscode.WorkspaceFolder[]): Promise<ResolvedMeta | null> {
  // TODO: respect config? Why does enable exist? Can't you just disable the extension?
  // if (getConfig(workspace).enable === false || getRootConfig().disabledWorkspaceFolders.includes(workspace.name))
  //   return null
  // TODO: check compatibility with version >= 0.34.0(?)
  const meta = resolveVitestFoldersMeta(folders)
  if (!meta.length)
    return null

  log.info('[API]', `Running Vitest: ${meta.map(x => `v${x.version} (${x.vitestNodePath})}`).join(', ')}`)

  const vitest = await createChildVitestProcess(meta)

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
    handlers,
  }
}
