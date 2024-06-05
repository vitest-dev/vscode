import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { gte } from 'semver'
import { dirname, normalize, relative } from 'pathe'
import * as vscode from 'vscode'
import { log } from './log'
import { workerPath } from './constants'
import { getConfig } from './config'
import type { BirpcEvents, VitestEvents, VitestRPC } from './api/rpc'
import { createVitestRpc } from './api/rpc'
import type { WorkerRunnerOptions } from './worker/types'
import type { VitestPackage } from './api/pkg'
import { findNode, pluralize, showVitestError } from './utils'
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
      this.handlers[name]((id, ...args) => {
        if (id === this.id)
          (callback as any)(...args)
      })
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

const WEAKMAP_API_FOLDER = new WeakMap<VitestFolderAPI, vscode.WorkspaceFolder>()

export class VitestFolderAPI extends VitestReporter {
  readonly tag: vscode.TestTag

  constructor(
    private pkg: VitestPackage,
    private meta: ResolvedMeta,
  ) {
    const normalizedId = normalize(pkg.id)
    super(normalizedId, meta.handlers)
    WEAKMAP_API_FOLDER.set(this, pkg.folder)
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

  get workspaceFolder() {
    return WEAKMAP_API_FOLDER.get(this)!
  }

  async runFiles(files?: string[], testNamePatern?: string) {
    await this.meta.rpc.runTests(this.id, files?.map(normalize), testNamePatern)
  }

  async updateSnapshots(files?: string[], testNamePatern?: string) {
    await this.meta.rpc.updateSnapshots(this.id, files?.map(normalize), testNamePatern)
  }

  getFiles() {
    return this.meta.rpc.getFiles(this.id)
  }

  private testsQueue = new Set<string>()
  private collectPromise: Promise<void> | null = null
  private collectTimer: NodeJS.Timeout | null = null

  async collectTests(testFile: string) {
    this.testsQueue.add(testFile)

    this.collectTimer && clearTimeout(this.collectTimer)
    await this.collectPromise
    this.collectTimer && clearTimeout(this.collectTimer)

    this.collectTimer = setTimeout(() => {
      const tests = Array.from(this.testsQueue).map(normalize)
      const root = this.workspaceFolder.uri.fsPath
      this.testsQueue.clear()
      log.info('[API]', `Collecting tests: ${tests.map(t => relative(root, t)).join(', ')}`)
      this.collectPromise = this.meta.rpc.collectTests(this.id, tests).finally(() => {
        this.collectPromise = null
      })
    }, 50)
    await this.collectPromise
  }

  async dispose() {
    WEAKMAP_API_FOLDER.delete(this)
    this.handlers.clearListeners()
    this.meta.packages.forEach((pkg) => {
      delete require.cache[pkg.vitestPackageJsonPath]
    })
    if (!this.meta.process.closed) {
      try {
        await this.meta.rpc.close()
        log.info('[API]', `Vitest process ${this.meta.process.id} closed successfully`)
      }
      catch (err) {
        log.error('[API]', 'Failed to close Vitest process', err)
      }
      const promise = new Promise<void>((resolve) => {
        this.meta.process.once('exit', () => resolve())
      })
      this.meta.process.close()
      await promise
    }
  }

  async cancelRun() {
    await this.meta.rpc.cancelRun(this.id)
  }

  waitForCoverageReport() {
    return this.meta.rpc.waitForCoverageReport(this.id)
  }

  async enableCoverage() {
    await this.meta.rpc.enableCoverage(this.id)
  }

  async disableCoverage() {
    await this.meta.rpc.disableCoverage(this.id)
  }

  async watchTests(files?: string[], testNamePattern?: string) {
    await this.meta.rpc.watchTests(this.id, files?.map(normalize), testNamePattern)
  }

  async unwatchTests() {
    await this.meta.rpc.unwatchTests(this.id)
  }
}

export async function resolveVitestAPI(showWarning: boolean, packages: VitestPackage[]) {
  const promises = packages.map(async (pkg) => {
    const vitest = await createVitestProcess(showWarning, [pkg])
    return new VitestFolderAPI(pkg, vitest)
  })
  const apis = await Promise.all(promises)
  return new VitestAPI(apis)
}

export interface ResolvedMeta {
  rpc: VitestRPC
  process: VitestProcess
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

async function createChildVitestProcess(showWarning: boolean, meta: VitestPackage[]) {
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
  const env = getConfig().env || {}
  const execPath = getConfig().nodeExecutable || await findNode(vscode.workspace.workspaceFile?.fsPath || vscode.workspace.workspaceFolders![0].uri.fsPath)
  log.info('[API]', `Running Vitest: ${meta.map(x => `v${x.version} (${relative(dirname(x.cwd), x.id)})`).join(', ')} with Node.js: ${execPath}`)
  const vitest = fork(
    workerPath,
    {
      execPath,
      execArgv,
      env: {
        ...process.env,
        ...env,
        VITEST_VSCODE: 'true',
        // same env var as `startVitest`
        // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
        TEST: 'true',
        VITEST: 'true',
        NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
      },
      stdio: 'overlapped',
      cwd: pnp ? dirname(pnp) : meta[0].cwd,
    },
  )

  vitest.stdout?.on('data', d => log.worker('info', d.toString()))
  vitest.stderr?.on('data', d => log.worker('error', d.toString()))

  return new Promise<ChildProcess>((resolve, reject) => {
    function ready(message: any) {
      if (message.type === 'debug')
        log.worker('info', ...message.args)

      if (message.type === 'ready') {
        vitest.off('message', ready)
        // started _some_ projects, but some failed - log them, this can only happen if there are multiple projects
        if (message.errors.length) {
          message.errors.forEach(([id, error]: [string, string]) => {
            const metaIndex = meta.findIndex(m => m.id === id)
            meta.splice(metaIndex, 1)
            log.error('[API]', `Vitest failed to start for ${id}: \n${error}`)
          })
          if (showWarning) {
            const errorsNumber = message.errors.length
            const resultButton = errorsNumber > 1 ? 'See errors' : 'See error'
            vscode.window.showWarningMessage(
              `There ${errorsNumber > 1 ? 'were' : 'was'} ${pluralize(message.errors.length, 'error')} during Vitest startup. Check the output for more details.`,
              resultButton,
            ).then((result) => {
              if (result === resultButton)
                vscode.commands.executeCommand('vitest.openOutput')
            })
          }
        }
        resolve(vitest)
      }
      if (message.type === 'error') {
        vitest.off('message', ready)
        const error = new Error(`Vitest failed to start: \n${message.errors.map((r: any) => r[1]).join('\n')}`)
        reject(error)
      }
      vitest.off('error', error)
      vitest.off('message', ready)
      vitest.off('exit', exit)
    }

    function error(err: Error) {
      log.error('[API]', err)
      reject(err)
      vitest.off('error', error)
      vitest.off('message', ready)
      vitest.off('exit', exit)
    }

    function exit(code: number) {
      reject(new Error(`Vitest process exited with code ${code}`))
    }

    vitest.on('error', error)
    vitest.on('message', ready)
    vitest.on('exit', exit)
    vitest.once('spawn', () => {
      const runnerOptions: WorkerRunnerOptions = {
        type: 'init',
        meta: meta.map(m => ({
          vitestNodePath: m.vitestNodePath,
          env: getConfig(m.folder).env || undefined,
          configFile: m.configFile,
          cwd: m.cwd,
          arguments: m.arguments,
          workspaceFile: m.workspaceFile,
          id: m.id,
        })),
        loader: pnpLoaders[0] && gte(process.version, '18.19.0') ? pnpLoaders[0] : undefined,
      }

      vitest.send(runnerOptions)
    })
  })
}

// TODO: packages should be a single package
export async function createVitestProcess(showWarning: boolean, packages: VitestPackage[]): Promise<ResolvedMeta> {
  const vitest = await createChildVitestProcess(showWarning, packages)

  log.info('[API]', `Vitest ${packages.map(x => `v${x.version} (${relative(dirname(x.cwd), x.id)})`).join(', ')} process ${vitest.pid} created`)

  const { handlers, api } = createVitestRpc({
    on: listener => vitest.on('message', listener),
    send: message => vitest.send(message),
  })

  return {
    rpc: api,
    process: new VitestChildProvess(vitest),
    handlers,
    packages,
  }
}

class VitestChildProvess implements VitestProcess {
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
