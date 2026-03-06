import type { SerializedProject } from 'vitest-vscode-shared'
import type { VitestPackage } from './spawn/pkg'
import type { ExtensionWorkerEvents, VitestExtensionRPC } from './spawn/rpc'
import type { ExtensionWorkerProcess } from './spawn/types'
import type { ProcessSpawnOptions } from './spawn/ws'
import type { TestFileMetadata } from './testTreeData'
import { readFileSync } from 'node:fs'
import { normalize, relative } from 'pathe'
import pm from 'picomatch'
import { createQueuedHandler } from 'vitest-vscode-shared'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { log } from './log'
import { createVitestProcess } from './spawn/child_process'
import { createVitestTerminalProcess } from './spawn/terminal'

export class VitestProjectConfig {
  readonly id: string
  readonly tag: vscode.TestTag
  readonly workspaceFolder: vscode.WorkspaceFolder

  constructor(
    readonly pkg: VitestPackage,
    readonly projects: SerializedProject[],
    readonly workspaceSource: string | false,
  ) {
    this.id = normalize(pkg.id)
    this.workspaceFolder = pkg.folder
    this.tag = new vscode.TestTag(pkg.prefix)
  }

  get prefix() {
    return this.pkg.prefix
  }

  get configs() {
    return this.projects.map(p => p.config).filter(n => n != null)
  }

  get version() {
    return this.pkg.version
  }

  get package() {
    return this.pkg
  }

  getPotentialTestFileMetadata(file: string): TestFileMetadata[] {
    const metadata: TestFileMetadata[] = []
    let fileContent: string
    for (const project of this.projects) {
      if (this.matchesTestGlob(project, file, () => (fileContent ??= readFileSync(file, 'utf-8')))) {
        metadata.push({
          pool: project.pool,
          project: project.name,
          browser: project.browser,
        })
      }
    }
    return metadata
  }

  matchesTestGlob(project: SerializedProject, moduleId: string, source: () => string) {
    const relativeId = relative(project.dir || project.root, moduleId)
    if (pm.isMatch(relativeId, project.exclude)) {
      return false
    }
    if (pm.isMatch(relativeId, project.include)) {
      return true
    }
    if (
      project.includeSource?.length
      && pm.isMatch(relativeId, project.includeSource)
    ) {
      const code = source()
      if (code.includes('import.meta.vitest')) {
        return true
      }
    }
    return false
  }
}

export class VitestProcessAPI {
  readonly config: VitestProjectConfig

  // Listeners for collection results (registered by testTree)
  private collectionListeners: ExtensionWorkerEvents['onCollected'][] = []

  // Currently active process (for cancellation, continuous run)
  private currentMeta: ResolvedMeta | undefined

  constructor(config: VitestProjectConfig) {
    this.config = config
  }

  /**
   * Create a VitestFolderAPI for debug sessions where the process is
   * already spawned by the debug launcher. spawnForRun() will return
   * a handle wrapping the existing process (without closing it).
   */
  static forDebug(pkg: VitestPackage, meta: ResolvedMeta): VitestProcessAPI {
    const config = new VitestProjectConfig(pkg, meta.projects, meta.workspaceSource)
    const api = new VitestProcessAPI(config)
    api.currentMeta = meta
    return api
  }

  // --- Delegated from config (local, no process needed) ---

  get id() {
    return this.config.id
  }

  get tag() {
    return this.config.tag
  }

  get workspaceFolder() {
    return this.config.workspaceFolder
  }

  get prefix() {
    return this.config.prefix
  }

  get configs() {
    return this.config.configs
  }

  get workspaceSource() {
    return this.config.workspaceSource
  }

  get package() {
    return this.config.package
  }

  getPersistentProcessMeta() {
    return this.currentMeta
  }

  getPotentialTestFileMetadata(file: string): TestFileMetadata[] {
    return this.config.getPotentialTestFileMetadata(file)
  }

  matchesTestGlob(project: SerializedProject, moduleId: string, source: () => string) {
    return this.config.matchesTestGlob(project, moduleId, source)
  }

  // --- Collection (on-demand, batched ~300ms) ---

  onCollected(callback: ExtensionWorkerEvents['onCollected']) {
    this.collectionListeners.push(callback)
  }

  collectTests(projectName: string, testFile: string) {
    return this._collectTests(`${projectName}\0${normalize(testFile)}`)
  }

  private _collectTests = createQueuedHandler(async (testsQueue: string[]) => {
    const tests = testsQueue.map((spec) => {
      const [projectName, filepath] = spec.split('\0', 2)
      return [projectName, filepath] as [string, string]
    })
    const root = this.workspaceFolder.uri.fsPath
    log.info('[API]', `Collecting tests: ${tests.map(t => `${relative(root, t[1])}${t[0] ? ` [${t[0]}]` : ''}`).join(', ')}`)
    try {
      await withProcess(this.config.pkg, async (meta) => {
        meta.handlers.onCollected((file, collecting) => {
          for (const listener of this.collectionListeners) {
            listener(file, collecting)
          }
        })
        await meta.rpc.collectTests(tests)
      })
    }
    catch (err) {
      log.error('[API]', 'Collection failed:', err)
    }
  }, 300)

  // --- Running (on-demand, spawned per run) ---

  /**
   * Spawn a process for running tests. The caller (TestRunner) manages
   * event wiring and lifecycle. Returns a RunHandle.
   */
  async spawnForRun(options?: ProcessSpawnOptions): Promise<RunHandle> {
    // For debug sessions, the process is already spawned — return a non-closing handle
    if (this.currentMeta && !this.currentMeta.process.closed) {
      const meta = this.currentMeta
      return {
        rpc: meta.rpc,
        process: meta.process,
        handlers: meta.handlers,
        async dispose() {
          // Debug process lifecycle is managed by the debug session, not by us
        },
      }
    }
    const meta = await spawnVitestProcess(this.config.pkg, options)
    this.currentMeta = meta
    return {
      rpc: meta.rpc,
      process: meta.process,
      handlers: meta.handlers,
      dispose: async () => {
        this.currentMeta = undefined
        await meta.dispose().catch((err) => {
          log.error('[API]', 'Failed to close Vitest process', err)
        })
      },
    }
  }

  async cancelRun() {
    if (!this.currentMeta || this.currentMeta.process.closed)
      return
    await this.currentMeta.rpc.cancelRun()
  }

  // --- Module diagnostics (from run process, before closing) ---

  async getSourceModuleDiagnostic(moduleId: string) {
    if (!this.currentMeta || this.currentMeta.process.closed)
      return { modules: [], untrackedModules: [] }
    return this.currentMeta.rpc.getSourceModuleDiagnostic(moduleId)
  }

  async getModuleEnvironments(moduleId: string) {
    if (!this.currentMeta || this.currentMeta.process.closed)
      return []
    return this.currentMeta.rpc.getModuleEnvironments(moduleId)
  }

  async getTransformedModule(project: string, environment: string, moduleId: string) {
    if (!this.currentMeta || this.currentMeta.process.closed) {
      return null
    }
    return this.currentMeta.rpc.getTransformedModule(project, environment, moduleId)
  }

  onFileChanged = createQueuedHandler(async (files: string[]) => {
    if (!this.currentMeta || this.currentMeta.process.closed) {
      return
    }
    return this.currentMeta.rpc.onFilesChanged(files).catch((err) => {
      log.error('[API]', 'Failed to notify Vitest about file change', err)
    })
  })

  // --- Cleanup ---

  async dispose() {
    delete require.cache[this.config.pkg.vitestPackageJsonPath]
    delete require.cache[this.config.pkg.vitestNodePath]
    if (this.currentMeta && !this.currentMeta.process.closed) {
      await this.currentMeta.dispose().catch((err) => {
        log.error('[API]', 'Failed to close Vitest process', err)
      })
    }
    this.currentMeta = undefined
    this.collectionListeners = []
  }
}

export interface RunHandle {
  rpc: VitestExtensionRPC
  process: ExtensionWorkerProcess
  handlers: ResolvedMeta['handlers']
  dispose: () => Promise<void>
}

export interface RunHandlers {
  onCollected: ExtensionWorkerEvents['onCollected']
  onTaskUpdate: ExtensionWorkerEvents['onTaskUpdate']
  onTestRunStart: ExtensionWorkerEvents['onTestRunStart']
  onTestRunEnd: ExtensionWorkerEvents['onTestRunEnd']
  onConsoleLog: ExtensionWorkerEvents['onConsoleLog']
}

export interface ResolvedMeta {
  rpc: VitestExtensionRPC
  process: ExtensionWorkerProcess
  workspaceSource: string | false
  pkg: VitestPackage
  projects: SerializedProject[]
  handlers: {
    onProcessLog: (listener: ExtensionWorkerEvents['onProcessLog']) => void
    onConsoleLog: (listener: ExtensionWorkerEvents['onConsoleLog']) => void
    onTaskUpdate: (listener: ExtensionWorkerEvents['onTaskUpdate']) => void
    onTestRunEnd: (listener: ExtensionWorkerEvents['onTestRunEnd']) => void
    onTestRunStart: (listener: ExtensionWorkerEvents['onTestRunStart']) => void
    onCollected: (listener: ExtensionWorkerEvents['onCollected']) => void
    clearListeners: () => void
    removeListener: (name: string, listener: any) => void
  }
  /**
   * Closes vitest process, will force exit with timeout, stops the WS server.
   */
  dispose: () => Promise<void>
}

export function spawnVitestProcess(pkg: VitestPackage, options?: ProcessSpawnOptions): Promise<ResolvedMeta> {
  const config = getConfig(pkg.folder)
  if (config.cliArguments && !pkg.arguments) {
    pkg.arguments = `vitest ${config.cliArguments}`
  }
  return config.shellType === 'terminal'
    ? createVitestTerminalProcess(pkg, options)
    : createVitestProcess(pkg, options)
}

export async function withProcess<T>(
  pkg: VitestPackage,
  fn: (meta: ResolvedMeta) => Promise<T>,
): Promise<T> {
  log.verbose?.('[API]', 'Spawning on-demand process...')
  const meta = await spawnVitestProcess(pkg)
  log.verbose?.('[API]', 'Process spawned, running callback')
  try {
    return await fn(meta)
  }
  finally {
    log.verbose?.('[API]', 'Callback done, closing process')
    await meta.dispose().catch((err) => {
      log.error('[API]', 'Failed to close Vitest process', err)
    })
  }
}
