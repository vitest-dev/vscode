import { normalize, relative } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import type { SerializedTestSpecification, VitestEvents, VitestRPC } from './api/rpc'
import type { VitestPackage } from './api/pkg'
import { showVitestError } from './utils'
import type { VitestProcess } from './api/types'
import { createVitestTerminalProcess } from './api/terminal'
import { getConfig } from './config'
import { createVitestProcess } from './api/child_process'

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
      process.on('error', warn)
      this._disposes.push(() => {
        process.off('error', warn)
      })
    })
  }

  onUnexpectedExit(callback: (code: number | null) => void) {
    this.processes.forEach((process) => {
      const onExit = (code: number | null) => {
        if (!this.disposing)
          callback(code)
      }
      process.on('exit', onExit)
      this._disposes.push(() => {
        process.off('exit', onExit)
      })
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
    return this.meta.rpc.onFilesCreated(files)
  })

  onFileChanged = createQueuedHandler(async (files: string[]) => {
    if (this.process.closed) {
      return
    }
    return this.meta.rpc.onFilesChanged(files)
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
      const promise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Vitest process did not exit in time'))
        }, 5_000)
        this.meta.process.once('exit', () => {
          resolve()
          clearTimeout(timer)
        })
      })
      this.meta.process.close()
      await promise.catch((err) => {
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

  private createHandler<K extends Exclude<keyof ResolvedMeta['handlers'], 'clearListeners' | 'removeListener'>>(name: K) {
    return (callback: VitestEvents[K]) => {
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

export async function resolveVitestAPI(packages: VitestPackage[]) {
  const promises = packages.map(async (pkg) => {
    const config = getConfig(pkg.folder)
    const vitest = config.shellType === 'terminal'
      ? await createVitestTerminalProcess(pkg)
      : await createVitestProcess(pkg)
    return new VitestFolderAPI(pkg, vitest)
  })
  const apis = await Promise.all(promises)
  return new VitestAPI(apis)
}

export interface ResolvedMeta {
  rpc: VitestRPC
  process: VitestProcess
  pkg: VitestPackage
  handlers: {
    onConsoleLog: (listener: VitestEvents['onConsoleLog']) => void
    onTaskUpdate: (listener: VitestEvents['onTaskUpdate']) => void
    onFinished: (listener: VitestEvents['onFinished']) => void
    onCollected: (listener: VitestEvents['onCollected']) => void
    onWatcherStart: (listener: VitestEvents['onWatcherStart']) => void
    onWatcherRerun: (listener: VitestEvents['onWatcherRerun']) => void
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
