import { dirname, isAbsolute } from 'node:path'
import { normalize, relative } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import type { ExtensionWorkerEvents, SerializedTestSpecification, VitestRPC } from './api/rpc'
import type { VitestPackage } from './api/pkg'
import { createVitestWorkspaceFile, noop, showVitestError } from './utils'
import { createVitestTerminalProcess } from './api/terminal'
import { getConfig } from './config'
import { createVitestProcess } from './api/child_process'
import type { ExtensionWorkerProcess } from './api/types'

export class VitestAPI {
  private disposing = false
  private _disposes: (() => void)[] = []

  constructor(
    private readonly api: VitestFolderAPI[],
  ) {
    this.processes.forEach((process) => {
      const warn = (error: any) => {
        if (!this.disposing)
          showVitestError('Vitest process failed', error)
      }
      const dispose = process.onError(warn)
      this._disposes.push(dispose)
    })
  }

  onUnexpectedExit(callback: (code: number | null) => void) {
    this.processes.forEach((process) => {
      const onExit = (code: number | null) => {
        if (!this.disposing)
          callback(code)
      }
      const dispose = process.onExit(onExit)
      this._disposes.push(dispose)
    })
  }

  forEach<T>(callback: (api: VitestFolderAPI, index: number) => T) {
    return this.api.forEach(callback)
  }

  get folderAPIs() {
    return this.api
  }

  async dispose() {
    this.disposing = true
    try {
      this._disposes.forEach(dispose => dispose())
      await Promise.all(this.api.map(api => api.dispose()))
    }
    finally {
      this.disposing = false
    }
  }

  private get processes() {
    return this.api.map(api => api.process)
  }
}

export class VitestFolderAPI {
  readonly id: string
  readonly tag: vscode.TestTag
  readonly workspaceFolder: vscode.WorkspaceFolder

  private handlers: ResolvedMeta['handlers']

  public createDate = Date.now()

  constructor(
    private pkg: VitestPackage,
    private meta: ResolvedMeta,
  ) {
    const normalizedId = normalize(pkg.id)
    this.id = normalizedId
    this.workspaceFolder = pkg.folder
    this.handlers = meta.handlers
    this.tag = new vscode.TestTag(pkg.prefix)
  }

  get processId() {
    return this.process.id
  }

  get prefix() {
    return this.pkg.prefix
  }

  get process() {
    return this.meta.process
  }

  get configs() {
    return this.meta.configs
  }

  get workspaceSource() {
    return this.meta.workspaceSource
  }

  get version() {
    return this.pkg.version
  }

  get package() {
    return this.pkg
  }

  async runFiles(specs?: SerializedTestSpecification[] | string[], testNamePatern?: string) {
    await this.meta.rpc.runTests(normalizeSpecs(specs), testNamePatern)
  }

  async updateSnapshots(specs?: SerializedTestSpecification[] | string[], testNamePatern?: string) {
    await this.meta.rpc.updateSnapshots(normalizeSpecs(specs), testNamePatern)
  }

  getFiles() {
    return this.meta.rpc.getFiles()
  }

  onFileCreated = createQueuedHandler(async (files: string[]) => {
    if (this.process.closed) {
      return
    }
    return this.meta.rpc.onFilesCreated(files).catch((err) => {
      log.error('[API]', 'Failed to notify Vitest about file creation', err)
    })
  })

  onFileChanged = createQueuedHandler(async (files: string[]) => {
    if (this.process.closed) {
      return
    }
    return this.meta.rpc.onFilesChanged(files).catch((err) => {
      log.error('[API]', 'Failed to notify Vitest about file change', err)
    })
  })

  async collectTests(projectName: string, testFile: string) {
    return this._collectTests(`${projectName}\0${normalize(testFile)}`)
  }

  private _collectTests = createQueuedHandler(async (testsQueue: string[]) => {
    if (this.process.closed) {
      return
    }
    const tests = Array.from(testsQueue).map((spec) => {
      const [projectName, filepath] = spec.split('\0', 2)
      return [projectName, filepath] as [string, string]
    })
    const root = this.workspaceFolder.uri.fsPath
    log.info('[API]', `Collecting tests: ${tests.map(t => `${relative(root, t[1])}${t[0] ? ` [${t[0]}]` : ''}`).join(', ')}`)
    return this.meta.rpc.collectTests(tests)
  })

  async dispose() {
    this.handlers.clearListeners()
    delete require.cache[this.meta.pkg.vitestPackageJsonPath]
    delete require.cache[this.meta.pkg.vitestNodePath]
    if (!this.meta.process.closed) {
      try {
        await this.meta.rpc.close()
        log.info('[API]', `Vitest process ${this.processId} closed successfully`)
      }
      catch (err) {
        log.error('[API]', 'Failed to close Vitest RPC', err)
      }
      await this.meta.process.close().catch((err) => {
        log.error('[API]', 'Failed to close Vitest process', err)
      })
    }
  }

  async cancelRun() {
    if (this.process.closed)
      return
    await this.meta.rpc.cancelRun()
  }

  waitForCoverageReport() {
    return this.meta.rpc.waitForCoverageReport()
  }

  async invalidateIstanbulTestModules(modules: string[] | null) {
    await this.meta.rpc.invalidateIstanbulTestModules(modules)
  }

  async enableCoverage() {
    await this.meta.rpc.enableCoverage()
  }

  async disableCoverage() {
    await this.meta.rpc.disableCoverage()
  }

  async watchTests(files?: SerializedTestSpecification[] | string[], testNamePattern?: string) {
    await this.meta.rpc.watchTests(normalizeSpecs(files), testNamePattern)
  }

  async unwatchTests() {
    await this.meta.rpc.unwatchTests()
  }

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

  onStdout(callback: (log: string) => void) {
    this.handlers.onStdout(callback)
  }

  private createHandler<K extends Exclude<keyof ResolvedMeta['handlers'], 'clearListeners' | 'removeListener' | 'onStdout'>>(name: K) {
    return (callback: ExtensionWorkerEvents[K]) => {
      this.handlers[name](callback as any)
    }
  }
}

function createQueuedHandler<T>(resolver: (value: T[]) => Promise<void>) {
  const cached = new Set<T>()
  let promise: Promise<void> | null = null
  let timer: NodeJS.Timeout | null = null
  return (value: T) => {
    cached.add(value)
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      if (promise) {
        return
      }
      const values = Array.from(cached)
      cached.clear()
      promise = resolver(values).finally(() => {
        promise = null
      })
    }, 50)
  }
}

export async function resolveVitestAPI(workspaceConfigs: VitestPackage[], configs: VitestPackage[]) {
  const usedConfigs = new Set<string>()
  const workspacePromises = workspaceConfigs.map(pkg => createVitestFolderAPI(usedConfigs, pkg))

  if (workspacePromises.length) {
    log.info('[API]', `Resolving workspace configs: ${workspaceConfigs.map(p => relative(p.folder.uri.fsPath, p.id)).join(', ')}`)
  }

  const resolvedApisPromises = await Promise.allSettled(workspacePromises)
  const errors: unknown[] = []
  const apis: VitestFolderAPI[] = []
  for (const api of resolvedApisPromises) {
    if (api.status === 'fulfilled') {
      apis.push(api.value)
    }
    else {
      errors.push(api.reason)
    }
  }

  const configsToResolve = configs.filter((pkg) => {
    return !pkg.configFile || pkg.workspaceFile || !usedConfigs.has(pkg.configFile)
  }).sort((a, b) => {
    const depthA = a.id.split('/').length
    const depthB = b.id.split('/').length
    return depthA - depthB
  })

  const maximumConfigs = getConfig().maximumConfigs ?? 3

  const workspaceRoots: string[] = apis
    .map(api => api.workspaceSource ? dirname(api.workspaceSource) : null)
    .filter(api => api != null)

  let configsResolved = 0

  if (configsToResolve.length) {
    log.info('[API]', `Resolving configs: ${configsToResolve.map(p => relative(dirname(p.cwd), p.id)).join(', ')}`)
  }

  // one by one because it's possible some of them have "workspace:" -- the configs are already sorted by priority
  for (const pkg of configsToResolve) {
    // if the config is used by the workspace, ignore the config
    if (pkg.configFile && usedConfigs.has(pkg.configFile)) {
      log.info('[API]', `Ignoring config ${relative(dirname(pkg.cwd), pkg.id)} because it's already used by the workspace`)
      continue
    }

    // if the config is defined in the directory that is covered by the workspace, ignore the config
    if (pkg.configFile && isCoveredByWorkspace(workspaceRoots, pkg.configFile)) {
      log.info('[API]', `Ignoring config ${relative(dirname(pkg.cwd), pkg.id)} because there is a workspace config in the parent folder`)
      continue
    }

    configsResolved++

    if (configsResolved > maximumConfigs) {
      warnPerformanceConfigLimit(configsToResolve)
      break
    }

    try {
      const api = await createVitestFolderAPI(usedConfigs, pkg)
      apis.push(api)
      if (api.workspaceSource) {
        workspaceRoots.push(dirname(api.workspaceSource))
      }
    }
    catch (err: unknown) {
      errors.push(err)
    }
  }

  if (!apis.length) {
    throw new AggregateError(errors, 'The extension could not load some configs.')
  }
  else if (errors.length) {
    log.error('There were errors during config load.')
    log.error(errors)
    showVitestError('The extension could not load some configs')
  }

  return new VitestAPI(apis)
}

function isCoveredByWorkspace(workspacesRoots: string[], currentConfig: string): boolean {
  return workspacesRoots.some((root) => {
    const relative_ = relative(root, currentConfig)
    return !relative_.startsWith('..') && !isAbsolute(relative_)
  })
}

function warnPerformanceConfigLimit(configsToResolve: VitestPackage[]) {
  const maximumConfigs = getConfig().maximumConfigs ?? 3
  const warningMessage = [
    'Vitest found multiple config files.',
    `The extension will use only the first ${maximumConfigs} due to performance concerns.`,
    'Consider using a workspace configuration to group your configs or increase',
    'the limit via "vitest.maximumConfigs" option.',
  ].join(' ')

  const folders = Array.from(new Set(configsToResolve.map(c => c.folder)))
  const allConfigs = [...configsToResolve]
  // remove all but the first 3
  const discardedConfigs = configsToResolve.splice(maximumConfigs)

  if (folders.every(f => getConfig(f).disableWorkspaceWarning !== true)) {
    vscode.window.showWarningMessage(
      warningMessage,
      'Create vitest.workspace.js',
      'Disable notification',
    ).then((result) => {
      if (result === 'Create vitest.workspace.js')
        createVitestWorkspaceFile(allConfigs).catch(noop)

      if (result === 'Disable notification') {
        folders.forEach((folder) => {
          const rootConfig = vscode.workspace.getConfiguration('vitest', folder)
          rootConfig.update('disableWorkspaceWarning', true)
        })
      }
    })
  }
  else {
    log.info(warningMessage)
    log.info(`Discarded config files: ${discardedConfigs.map(x => x.workspaceFile || x.configFile).join(', ')}`)
  }
}

async function createVitestFolderAPI(usedConfigs: Set<string>, pkg: VitestPackage) {
  const config = getConfig(pkg.folder)
  if (config.cliArguments && !pkg.arguments) {
    pkg.arguments = `vitest ${config.cliArguments}`
  }
  const vitest = config.shellType === 'terminal'
    ? await createVitestTerminalProcess(pkg)
    : await createVitestProcess(pkg)
  vitest.configs.forEach((config) => {
    usedConfigs.add(config)
  })
  return new VitestFolderAPI(pkg, vitest)
}

export interface ResolvedMeta {
  rpc: VitestRPC
  process: ExtensionWorkerProcess
  workspaceSource: string | false
  pkg: VitestPackage
  configs: string[]
  handlers: {
    onStdout: (listener: (log: string) => void) => void
    onConsoleLog: (listener: ExtensionWorkerEvents['onConsoleLog']) => void
    onTaskUpdate: (listener: ExtensionWorkerEvents['onTaskUpdate']) => void
    onFinished: (listener: ExtensionWorkerEvents['onFinished']) => void
    onCollected: (listener: ExtensionWorkerEvents['onCollected']) => void
    onWatcherStart: (listener: ExtensionWorkerEvents['onWatcherStart']) => void
    onWatcherRerun: (listener: ExtensionWorkerEvents['onWatcherRerun']) => void
    clearListeners: () => void
    removeListener: (name: string, listener: any) => void
  }
}

function normalizeSpecs(specs?: string[] | SerializedTestSpecification[]) {
  if (!specs) {
    return specs
  }
  return specs.map((spec) => {
    if (typeof spec === 'string') {
      return normalize(spec)
    }
    return [spec[0], normalize(spec[1])] as SerializedTestSpecification
  }) as string[] | SerializedTestSpecification[]
}
