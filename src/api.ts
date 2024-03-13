import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { gte } from 'semver'
import { dirname, normalize } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import { configGlob, minimumVersion, workerPath } from './constants'
import { getConfig } from './config'
import type { BirpcEvents, VitestEvents, VitestRPC } from './api/rpc'
import { createVitestRpc } from './api/rpc'
import { resolveVitestPackage } from './api/resolve'

const _require = require

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
    return this.meta.process.pid
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
    this.forEach(api => api.dispose())
    this.meta.process.kill()
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
    WEAKMAP_API_FOLDER.delete(this)
    this.handlers.clearListeners()
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
  process: ChildProcess
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

export async function resolveVitestPackages(): Promise<VitestMeta[]> {
  const configs = await vscode.workspace.findFiles(configGlob, '**/node_modules/**')

  return configs.map((configFile) => {
    const folder = vscode.workspace.getWorkspaceFolder(configFile)!
    const vitest = resolveVitestPackage(folder)

    if (!vitest) {
      log.error('[API]', `Vitest not found for ${configFile.fsPath}. Please run \`npm i --save-dev vitest\` to install Vitest.`)
      return null
    }

    if (vitest.pnp) {
      // TODO: try to load vitest package version from pnp
      return {
        folder,
        vitestNodePath: vitest.vitestNodePath,
        version: 'pnp',
        loader: vitest.pnp.loaderPath,
        pnp: vitest.pnp.pnpPath,
      }
    }

    const pkg = _require(vitest.vitestPackageJsonPath)
    if (!gte(pkg.version, minimumVersion)) {
      // TODO: show warning
      log.error('[API]', `Vitest v${pkg.version} is not supported. Vitest v${minimumVersion} or newer is required.`)
      return null
    }

    return {
      folder,
      vitestNodePath: vitest.vitestNodePath,
      version: pkg.version,
    }
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
      execPath: getConfig().nodeExecutable,
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
          env: getConfig(m.folder).env || undefined,
        })),
        loader: pnpLoaders[0] && gte(process.version, '18.19.0') ? pnpLoaders[0] : undefined,
      })
    })
  })
}

export async function createVitestProcess(meta: VitestMeta[]): Promise<ResolvedMeta> {
  log.info('[API]', `Running Vitest: ${meta.map(x => `v${x.version} (${x.folder.name})`).join(', ')}`)

  const vitest = await createChildVitestProcess(meta)

  log.info('[API]', `Vitest process ${vitest.pid} created`)

  vitest.stdout?.on('data', d => log.info('[Worker]', d.toString()))
  vitest.stderr?.on('data', d => log.error('[Worker]', d.toString()))

  const { handlers, api } = createVitestRpc(vitest)

  return {
    rpc: api,
    process: vitest,
    handlers,
  }
}
