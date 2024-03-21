import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { gte } from 'semver'
import { basename, dirname, normalize } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import { configGlob, minimumVersion, workerPath, workspaceGlob } from './constants'
import { getConfig } from './config'
import type { BirpcEvents, VitestEvents, VitestRPC } from './api/rpc'
import { createVitestRpc } from './api/rpc'
import { resolveVitestPackage } from './api/resolve'
import type { TestTree } from './testTree'
import type { WorkerRunnerOptions } from './worker/types'

const _require = require

export class VitestReporter {
  constructor(
    public readonly id: string,
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
      this.handlers[name]((id, ...args) => {
        if (id === this.id)
          (callback as any)(...args)
      })
    }
  }
}

export class VitestAPI {
  constructor(
    private readonly api: VitestFolderAPI[],
    private readonly meta: ResolvedMeta,
  ) {}

  forEach<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.forEach(callback)
  }

  get folderAPIs() {
    return this.api
  }

  async isTestFile(file: string) {
    return this.meta.rpc.isTestFile(file)
  }

  async dispose() {
    this.forEach(api => api.dispose())
    this.meta.packages.forEach((pkg) => {
      delete require.cache[pkg.vitestPackageJsonPath]
    })
    try {
      await this.meta.rpc.close()
    }
    catch {}
    this.meta.process.kill()
  }
}

const WEAKMAP_API_FOLDER = new WeakMap<VitestFolderAPI, vscode.WorkspaceFolder>()

export class VitestFolderAPI extends VitestReporter {
  readonly tag: vscode.TestTag

  constructor(
    folder: vscode.WorkspaceFolder,
    private meta: ResolvedMeta,
    id: string,
  ) {
    const normalizedId = normalize(id)
    super(normalizedId, meta.handlers)
    WEAKMAP_API_FOLDER.set(this, folder)
    // TODO: make it prettier, but still unique
    this.tag = new vscode.TestTag(this.id)
  }

  get processId() {
    return this.meta.process.pid
  }

  get workspaceFolder() {
    return WEAKMAP_API_FOLDER.get(this)!
  }

  isTestFile(file: string) {
    return this.meta.rpc.isTestFile(file)
  }

  async runFiles(files?: string[], testNamePatern?: string) {
    await this.meta.rpc.runTests(this.id, files?.map(normalize), testNamePatern)
  }

  getFiles() {
    return this.meta.rpc.getFiles(this.id)
  }

  async collectTests(testFile: string) {
    await this.meta.rpc.collectTests(this.id, normalize(testFile))
  }

  dispose() {
    WEAKMAP_API_FOLDER.delete(this)
    this.handlers.clearListeners()
  }

  async cancelRun() {
    await this.meta.rpc.cancelRun(this.id)
  }

  stopInspect() {
    return this.meta.rpc.stopInspect()
  }

  startInspect(port: number) {
    return this.meta.rpc.startInspect(port)
  }
}

export async function resolveVitestAPI(tree: TestTree, meta: VitestPackage[]) {
  const vitest = await createVitestProcess(tree, meta)
  const apis = meta.map(({ folder, id }) =>
    new VitestFolderAPI(folder, vitest, id),
  )
  return new VitestAPI(apis, vitest)
}

interface ResolvedMeta {
  rpc: VitestRPC
  process: ChildProcess
  packages: VitestPackage[]
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

export interface VitestPackage {
  folder: vscode.WorkspaceFolder
  vitestNodePath: string
  vitestPackageJsonPath: string
  // path to a config file or a workspace config file
  id: string
  configFile?: string
  workspaceFile?: string
  version: string
  loader?: string
  pnp?: string
}

function resolveVitestConfig(showWarning: boolean, configOrWorkspaceFile: vscode.Uri) {
  const folder = vscode.workspace.getWorkspaceFolder(configOrWorkspaceFile)!
  const vitest = resolveVitestPackage(dirname(configOrWorkspaceFile.fsPath), folder)

  if (!vitest) {
    if (showWarning)
      vscode.window.showWarningMessage(`Vitest not found in "${basename(dirname(configOrWorkspaceFile.fsPath))}" folder. Please run \`npm i --save-dev vitest\` to install Vitest.'`)
    log.error('[API]', `Vitest not found for ${configOrWorkspaceFile}.`)
    return null
  }

  if (vitest.pnp) {
    // TODO: try to load vitest package version from pnp
    return {
      folder,
      id: normalize(configOrWorkspaceFile.fsPath),
      vitestNodePath: vitest.vitestNodePath,
      vitestPackageJsonPath: vitest.vitestPackageJsonPath,
      version: 'pnp',
      loader: vitest.pnp.loaderPath,
      pnp: vitest.pnp.pnpPath,
    }
  }

  const pkg = _require(vitest.vitestPackageJsonPath)
  if (!gte(pkg.version, minimumVersion)) {
    const warning = `Vitest v${pkg.version} is not supported. Vitest v${minimumVersion} or newer is required.`
    if (showWarning)
      vscode.window.showWarningMessage(warning)
    else
      log.error('[API]', `[${folder}] Vitest v${pkg.version} is not supported. Vitest v${minimumVersion} or newer is required.`)
    delete require.cache[vitest.vitestPackageJsonPath]
    return null
  }

  return {
    folder,
    id: normalize(configOrWorkspaceFile.fsPath),
    vitestPackageJsonPath: vitest.vitestPackageJsonPath,
    vitestNodePath: vitest.vitestNodePath,
    version: pkg.version,
  }
}

export async function resolveVitestPackages(showWarning: boolean): Promise<VitestPackage[]> {
  const vitestWorkspaces = await vscode.workspace.findFiles(workspaceGlob, '**/node_modules/**')

  if (vitestWorkspaces.length) {
    // if there is a workspace config, use it as root
    return vitestWorkspaces.map((config) => {
      const vitest = resolveVitestConfig(showWarning, config)
      if (!vitest)
        return null
      return {
        ...vitest,
        workspaceFile: vitest.id,
      }
    }).filter(nonNullable)
  }

  const configs = await vscode.workspace.findFiles(configGlob, '**/node_modules/**')

  const configsByFolder = configs.reduce<Record<string, vscode.Uri[]>>((acc, config) => {
    const dir = dirname(config.fsPath)
    if (!acc[dir])
      acc[dir] = []
    acc[dir].push(config)
    return acc
  }, {})

  const resolvedMeta: VitestPackage[] = []

  for (const [_, configFiles] of Object.entries(configsByFolder)) {
    // vitest config always overrides vite config - if there is a Vitest config, we assume vite was overriden,
    // but it's possible to have several Vitest configs (vitest.e2e. vitest.unit, etc.)
    const hasViteAndVitestConfig = configFiles.some(file => basename(file.fsPath).includes('vite.'))
      && configFiles.some(file => basename(file.fsPath).includes('vitest.'))
    // remove all vite configs from a folder if there is at least one Vitest config
    const filteredConfigFiles = hasViteAndVitestConfig
      ? configFiles.filter(file => !basename(file.fsPath).includes('vite.'))
      : configFiles
    filteredConfigFiles.forEach((config) => {
      const vitest = resolveVitestConfig(showWarning, config)
      if (vitest)
        resolvedMeta.push(vitest)
    })
  }

  return resolvedMeta
}

function createChildVitestProcess(tree: TestTree, meta: VitestPackage[]) {
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
        pathToFileURL(pnpLoaders[0]).toString(),
      ]
    : undefined
  const vitest = fork(
    workerPath,
    {
      // TODO: use findNode API
      execPath: getConfig().nodeExecutable,
      execArgv,
      env: {
        ...process.env,
        VITEST_VSCODE: 'true',
        // same env var as `startVitest`
        // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
        TEST: 'true',
        VITEST: 'true',
        NODE_ENV: getConfig().env?.NODE_ENV ?? process.env.NODE_ENV ?? 'true',
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
        log.worker('info', ...message.args)

      if (message.type === 'ready') {
        vitest.off('message', ready)
        // started _some_ projects, but some failed - log them, this can only happen if there are multiple projects
        if (message.errors.length) {
          message.errors.forEach(([configFile, error]: [string, string]) => {
            const metaIndex = meta.findIndex(m => m.id === configFile)
            const metaItem = meta[metaIndex]
            const workspaceItem = tree.getOrCreateWorkspaceFolderItem(metaItem.folder.uri)
            workspaceItem.error = error // display error message in the tree
            workspaceItem.canResolveChildren = false
            meta.splice(metaIndex, 1)
            log.error('[API]', `Vitest failed to start for ${configFile}: \n${error}`)
          })
        }
        resolve(vitest)
      }
      if (message.type === 'error') {
        vitest.off('message', ready)
        const error = new Error(`Vitest failed to start: \n${message.errors.map((r: any) => r[1]).join('\n')}`)
        reject(error)
      }
    })
    vitest.on('spawn', () => {
      const runnerOptions: WorkerRunnerOptions = {
        type: 'init',
        meta: meta.map(m => ({
          vitestNodePath: m.vitestNodePath,
          env: getConfig(m.folder).env || undefined,
          configFile: m.configFile,
          workspaceFile: m.workspaceFile,
          id: m.id,
        })),
        loader: pnpLoaders[0] && gte(process.version, '18.19.0') ? pnpLoaders[0] : undefined,
      }

      vitest.send(runnerOptions)
    })
  })
}

export async function createVitestProcess(tree: TestTree, packages: VitestPackage[]): Promise<ResolvedMeta> {
  log.info('[API]', `Running Vitest: ${packages.map(x => `v${x.version} (${x.id})`).join(', ')}`)

  const vitest = await createChildVitestProcess(tree, packages)

  log.info('[API]', `Vitest process ${vitest.pid} created`)

  vitest.stdout?.on('data', d => log.worker('info', d.toString()))
  vitest.stderr?.on('data', d => log.worker('error', d.toString()))

  const { handlers, api } = createVitestRpc(vitest)

  return {
    rpc: api,
    process: vitest,
    handlers,
    packages,
  }
}
