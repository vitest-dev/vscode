import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { gte } from 'semver'
import { dirname, normalize, relative } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import { minimumNodeVersion, workerPath } from './constants'
import { getConfig } from './config'
import type { VitestEvents, VitestRPC } from './api/rpc'
import { createVitestRpc } from './api/rpc'
import type { WorkerEvent, WorkerRunnerOptions } from './worker/types'
import type { VitestPackage } from './api/pkg'
import { findNode, getNodeJsVersion, showVitestError } from './utils'
import type { VitestProcess } from './process'

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
      this.handlers[name](callback as any)
    }
  }
}

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

export class VitestFolderAPI extends VitestReporter {
  readonly tag: vscode.TestTag
  readonly workspaceFolder: vscode.WorkspaceFolder

  constructor(
    private pkg: VitestPackage,
    private meta: ResolvedMeta,
  ) {
    const normalizedId = normalize(pkg.id)
    super(normalizedId, meta.handlers)
    this.workspaceFolder = pkg.folder
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

  async runFiles(files?: string[], testNamePatern?: string) {
    await this.meta.rpc.runTests(files?.map(normalize), testNamePatern)
  }

  async updateSnapshots(files?: string[], testNamePatern?: string) {
    await this.meta.rpc.updateSnapshots(files?.map(normalize), testNamePatern)
  }

  getFiles() {
    return this.meta.rpc.getFiles()
  }

  private testsQueue = new Set<string>()
  private collectPromise: Promise<void> | null = null
  private collectTimer: NodeJS.Timeout | null = null

  async collectTests(projectName: string, testFile: string) {
    this.testsQueue.add(`${projectName}\0${normalize(testFile)}`)

    if (this.collectTimer) {
      clearTimeout(this.collectTimer)
    }

    await this.collectPromise

    if (this.collectTimer) {
      clearTimeout(this.collectTimer)
    }

    this.collectTimer = setTimeout(() => {
      const tests = Array.from(this.testsQueue).map((spec) => {
        const [projectName, filepath] = spec.split('\0', 2)
        return [projectName, filepath] as [string, string]
      })
      const root = this.workspaceFolder.uri.fsPath
      this.testsQueue.clear()
      log.info('[API]', `Collecting tests: ${tests.map(t => relative(root, t[1])).join(', ')}`)
      this.collectPromise = this.meta.rpc.collectTests(tests).finally(() => {
        this.collectPromise = null
      })
    }, 50)
    await this.collectPromise
  }

  async dispose() {
    this.handlers.clearListeners()
    delete require.cache[this.meta.pkg.vitestPackageJsonPath]
    if (!this.meta.process.closed) {
      try {
        await this.meta.rpc.close()
        log.info('[API]', `Vitest process ${this.processId} closed successfully`)
      }
      catch (err) {
        log.error('[API]', 'Failed to close Vitest RPC', err)
      }
      const promise = new Promise<void>((resolve) => {
        this.meta.process.once('exit', () => resolve())
      })
      this.meta.process.close()
      await Promise.all([
        promise,
        AbortSignal.timeout(5000),
      ]).catch((err) => {
        log.error('[API]', 'Failed to close Vitest process', err)
      })
    }
  }

  async cancelRun() {
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

  async watchTests(files?: string[], testNamePattern?: string) {
    await this.meta.rpc.watchTests(files?.map(normalize), testNamePattern)
  }

  async unwatchTests() {
    await this.meta.rpc.unwatchTests()
  }
}

export async function resolveVitestAPI(packages: VitestPackage[]) {
  const promises = packages.map(async (pkg) => {
    const vitest = await createVitestProcess(pkg)
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

function formapPkg(pkg: VitestPackage) {
  return `Vitest v${pkg.version} (${relative(dirname(pkg.cwd), pkg.id)})`
}

async function createChildVitestProcess(pkg: VitestPackage) {
  const pnpLoader = pkg.loader
  const pnp = pkg.pnp
  if (pnpLoader && !pnp)
    throw new Error('pnp file is required if loader option is used')
  const execArgv = pnpLoader && pnp && !gte(process.version, '18.19.0')
    ? [
        '--require',
        pnp,
        '--experimental-loader',
        pathToFileURL(pnpLoader).toString(),
      ]
    : undefined
  const env = getConfig().env || {}
  const execPath = await findNode(vscode.workspace.workspaceFile?.fsPath || pkg.cwd)
  const execVersion = await getNodeJsVersion(execPath)
  if (execVersion && !gte(execVersion, minimumNodeVersion)) {
    const errorMsg = `Node.js version ${execVersion} is not supported. Minimum required version is ${minimumNodeVersion}`
    log.error('[API]', errorMsg)
    throw new Error(errorMsg)
  }
  log.info('[API]', `Running ${formapPkg(pkg)} with Node.js: ${execPath}`)
  const logLevel = getConfig(pkg.folder).logLevel
  const vitest = fork(
    // to support pnp, we need to spawn `yarn node` instead of `node`
    workerPath,
    {
      execPath,
      execArgv,
      env: {
        ...process.env,
        ...env,
        VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? logLevel,
        VITEST_VSCODE: 'true',
        // same env var as `startVitest`
        // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
        TEST: 'true',
        VITEST: 'true',
        NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
      },
      stdio: 'overlapped',
      cwd: pnp ? dirname(pnp) : pkg.cwd,
    },
  )

  vitest.stdout?.on('data', d => log.worker('info', d.toString()))
  vitest.stderr?.on('data', (chunk) => {
    const string = chunk.toString()
    log.worker('error', string)
    if (string.startsWith(' MISSING DEPENDENCY')) {
      const error = string.split(/\r?\n/, 1)[0].slice(' MISSING DEPENDENCY'.length)
      showVitestError(error)
    }
  })

  return new Promise<ChildProcess>((resolve, reject) => {
    function onMessage(message: WorkerEvent) {
      if (message.type === 'debug')
        log.worker('info', ...message.args)

      if (message.type === 'ready') {
        resolve(vitest)
      }
      if (message.type === 'error') {
        const error = new Error(`Vitest failed to start: \n${message.error}`)
        reject(error)
      }
      vitest.off('error', onError)
      vitest.off('message', onMessage)
      vitest.off('exit', onExit)
    }

    function onError(err: Error) {
      log.error('[API]', err)
      reject(err)
      vitest.off('error', onError)
      vitest.off('message', onMessage)
      vitest.off('exit', onExit)
    }

    function onExit(code: number) {
      reject(new Error(`Vitest process exited with code ${code}`))
    }

    vitest.on('error', onError)
    vitest.on('message', onMessage)
    vitest.on('exit', onExit)
    vitest.once('spawn', () => {
      const runnerOptions: WorkerRunnerOptions = {
        type: 'init',
        meta: {
          vitestNodePath: pkg.vitestNodePath,
          env: getConfig(pkg.folder).env || undefined,
          configFile: pkg.configFile,
          cwd: pkg.cwd,
          arguments: pkg.arguments,
          workspaceFile: pkg.workspaceFile,
          id: pkg.id,
        },
        loader: pnpLoader && gte(process.version, '18.19.0')
          ? pathToFileURL(pnpLoader).toString()
          : undefined,
      }

      vitest.send(runnerOptions)
    })
  })
}

export async function createVitestProcess(pkg: VitestPackage): Promise<ResolvedMeta> {
  const vitest = await createChildVitestProcess(pkg)

  log.info('[API]', `${formapPkg(pkg)} process ${vitest.pid} created`)

  const { handlers, api } = createVitestRpc({
    on: listener => vitest.on('message', listener),
    send: message => vitest.send(message),
  })

  return {
    rpc: api,
    process: new VitestChildProcess(vitest),
    handlers,
    pkg,
  }
}

class VitestChildProcess implements VitestProcess {
  constructor(private child: ChildProcess) {}

  get id() {
    return this.child.pid ?? 0
  }

  get closed() {
    return this.child.killed
  }

  on(event: string, listener: (...args: any[]) => void) {
    this.child.on(event, listener)
  }

  once(event: string, listener: (...args: any[]) => void) {
    this.child.once(event, listener)
  }

  off(event: string, listener: (...args: any[]) => void) {
    this.child.off(event, listener)
  }

  close() {
    this.child.kill()
  }
}
