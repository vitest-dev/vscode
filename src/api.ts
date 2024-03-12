import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import v8 from 'node:v8'
import { pathToFileURL } from 'node:url'
import { gte } from 'semver'
import { dirname, normalize, resolve } from 'pathe'
import type * as vscode from 'vscode'
import { type BirpcReturn, createBirpc } from 'birpc'
import type { File, TaskResultPack, UserConsoleLog } from 'vitest'
import { log } from './log'
import { workerPath } from './constants'

const _require = require

// import { getConfig, getRootConfig } from './config'

export interface BirpcMethods {
  getFiles: () => Promise<Record<string, string[]>>
  runFiles: () => Promise<void>
  collectTests: (workspaceFolder: string, testFile: string) => Promise<void>
  cancelRun: () => Promise<void>
  runFolderFiles: (workspaceFolder: string, files?: string[], testNamePattern?: string) => Promise<void>
  isTestFile: (file: string) => Promise<boolean>

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
  catch (_) {
    return null
  }
}

function resolveVitestPnpPackagePath(workspace: vscode.WorkspaceFolder) {
  try {
    const pnpPath = require.resolve('./.pnp.cjs', {
      paths: [workspace.uri.fsPath],
    })
    const pnp = _require(pnpPath)
    const vitestPath = pnp.resolveToUnqualified(
      'vitest/package.json',
      workspace.uri.fsPath,
    ) as string
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [workspace.uri.fsPath],
      }),
      vitestPath,
      pnpPath,
    }
  }
  catch (_) {
    return null
  }
}

function resolveVitestNodePath(vitestPkgPath: string) {
  return pathToFileURL(resolve(dirname(vitestPkgPath), './dist/node.js')).toString()
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

  clearListeners(name?: Exclude<keyof ResolvedMeta['handlers'], 'clearListeners' | 'removeListener'>) {
    if (name)
      this.handlers.removeListener(name, this.handlers[name])

    this.handlers.clearListeners()
  }

  private createHandler<K extends Exclude<keyof ResolvedMeta['handlers'], 'clearListeners' | 'removeListener'>>(name: K) {
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

  get processId() {
    return this.meta.pid
  }

  get length() {
    return this.api.length
  }

  get(folder: vscode.WorkspaceFolder | string) {
    const folderFsPath = typeof folder === 'string' ? folder : folder.uri.fsPath
    return this.api.find(api => api.workspaceFolder.uri.fsPath === folderFsPath)!
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

  async isTestFile(file: string) {
    return this.meta.rpc.isTestFile(file)
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
    super(normalize(folder.uri.fsPath), handlers)
    WEAKMAP_API_FOLDER.set(this, folder)
  }

  get workspaceFolder() {
    return WEAKMAP_API_FOLDER.get(this)!
  }

  isTestFile(file: string) {
    return this.rpc.isTestFile(file)
  }

  async runFiles(files?: string[], testNamePatern?: string) {
    await this.rpc.runFolderFiles(this.workspacePath, files?.map(normalize), testNamePatern)
  }

  async collectTests(testFile: string) {
    await this.rpc.collectTests(this.workspacePath, normalize(testFile))
  }

  private get workspacePath() {
    return normalize(this.workspaceFolder.uri.fsPath)
  }

  dispose() {
    // TODO: terminate?
  }
}

export async function resolveVitestAPI(meta: VitestMeta[]) {
  const vitest = await createVitestProcess(meta)
  const apis = meta.map(({ folder }) =>
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
    removeListener: (name: string, listener: any) => void
  }
}

function createHandler<T extends (...args: any) => any>() {
  const handlers: T[] = []
  return {
    handlers,
    register: (listener: any) => handlers.push(listener),
    trigger: (...data: any) => handlers.forEach(handler => handler(...data)),
    clear: () => handlers.length = 0,
    remove: (listener: T) => {
      const index = handlers.indexOf(listener)
      if (index !== -1)
        handlers.splice(index, 1)
    },
  }
}

function createRpcOptions() {
  const handlers = {
    onConsoleLog: createHandler<BirpcEvents['onConsoleLog']>(),
    onTaskUpdate: createHandler<BirpcEvents['onTaskUpdate']>(),
    onFinished: createHandler<BirpcEvents['onFinished']>(),
    onCollected: createHandler<BirpcEvents['onCollected']>(),
    onWatcherRerun: createHandler<BirpcEvents['onWatcherRerun']>(),
    onWatcherStart: createHandler<BirpcEvents['onWatcherStart']>(),
  }

  const events: Omit<BirpcEvents, 'onReady' | 'onError'> = {
    onConsoleLog: handlers.onConsoleLog.trigger,
    onFinished: handlers.onFinished.trigger,
    onTaskUpdate: handlers.onTaskUpdate.trigger,
    onCollected: handlers.onCollected.trigger,
    onWatcherRerun: handlers.onWatcherRerun.trigger,
    onWatcherStart: handlers.onWatcherStart.trigger,
  }

  return {
    events,
    handlers: {
      onConsoleLog: handlers.onConsoleLog.register,
      onTaskUpdate: handlers.onTaskUpdate.register,
      onFinished: handlers.onFinished.register,
      onCollected: handlers.onCollected.register,
      onWatcherRerun: handlers.onWatcherRerun.register,
      onWatcherStart: handlers.onWatcherStart.register,
      removeListener(name: string, listener: any) {
        handlers[name as 'onCollected']?.remove(listener)
      },
      clearListeners() {
        for (const name in handlers)
          handlers[name as 'onCollected']?.clear()
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
  loader?: string
  pnp?: string
}

export function resolveVitestFoldersMeta(folders: readonly vscode.WorkspaceFolder[]): VitestMeta[] {
  return folders.map((folder) => {
    const vitestPackagePath = resolveVitestPackagePath(folder)
    if (!vitestPackagePath) {
      const pnp = resolveVitestPnpPackagePath(folder)
      if (!pnp)
        return null
      return {
        folder,
        vitestNodePath: resolveVitestNodePath(pnp.vitestPath),
        version: 'yarn pnp',
        loader: pnp.pnpLoader,
        pnp: pnp.pnpPath,
      }
    }
    const pkg = _require(vitestPackagePath)
    const vitestNodePath = resolveVitestNodePath(vitestPackagePath)
    return { folder, vitestNodePath, version: pkg.version }
  }).filter(nonNullable)
}

function createChildVitestProcess(meta: VitestMeta[]) {
  const pnpLoaders = [
    ...new Set(meta.map(meta => meta.loader).filter(Boolean) as string[]),
  ]
  const pnp = meta.find(meta => meta.pnp)?.pnp as string
  if (pnpLoaders.length > 1)
    throw new Error(`Multiple loaders are not supported: ${pnpLoaders.join(', ')}`)
  if (pnpLoaders.length && !pnp)
    throw new Error('pnp file is required if loader option is used')
  const execArgv = pnpLoaders[0] && !gte(process.version, '18.19.0')
    ? [
        '--require',
        pnp,
        '--experimental-loader',
        pnpLoaders[0],
      ]
    : undefined
  const vitest = fork(
    workerPath,
    {
      // TODO: use user's execPath to use the local node version (also expose an option?)
      execPath: undefined,
      execArgv,
      env: {
        VITEST_VSCODE: 'true',
      },
      stdio: 'overlapped',
      cwd: pnp ? dirname(pnp) : undefined,
    },
  )
  return new Promise<ChildProcess>((resolve, reject) => {
    vitest.on('error', (error) => {
      log.error('[API]', error)
      reject(error)
    })
    vitest.on('message', function ready(message: any) {
      if (message.type === 'debug')
        log.info('[WORKER]', ...message.args)

      if (message.type === 'ready') {
        vitest.off('message', ready)
        resolve(vitest)
      }
      if (message.type === 'error') {
        vitest.off('message', ready)
        reject(message.error)
      }
    })
    vitest.on('spawn', () => {
      vitest.send({
        type: 'init',
        meta: meta.map(m => ({
          vitestNodePath: m.vitestNodePath,
          folder: normalize(m.folder.uri.fsPath),
        })),
        loader: pnpLoaders[0] && gte(process.version, '18.19.0') ? pnpLoaders[0] : undefined,
      })
    })
  })
}

export async function createVitestProcess(meta: VitestMeta[]): Promise<ResolvedMeta> {
  log.info('[API]', `Running Vitest: ${meta.map(x => `v${x.version} (${x.vitestNodePath})`).join(', ')}`)

  const vitest = await createChildVitestProcess(meta)

  log.info('[API]', `Vitest process ${vitest.pid} created`)

  vitest.stdout?.on('data', d => log.info('[Worker]', d.toString()))
  vitest.stderr?.on('data', d => log.error('[Worker]', d.toString()))

  const { events, handlers } = createRpcOptions()

  const api = createBirpc<BirpcMethods, BirpcEvents>(
    events,
    {
      timeout: -1,
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
