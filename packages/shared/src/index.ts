import type { BirpcReturn } from 'birpc'
import type {
  RunnerTaskResultPack,
  RunnerTestFile,
  UserConsoleLog,
} from 'vitest'

export { WorkerWSEventEmitter } from './emitter'
export { createWorkerRPC } from './rpc'
export { assert, limitConcurrency, normalizeDriveLetter } from './utils'

export type ExtensionTestSpecification = [
  project: string,
  file: string,
]

export interface ExtensionWorkerTransport {
  getFiles: () => Promise<ExtensionTestSpecification[]>
  collectTests: (testFile: ExtensionTestSpecification[]) => Promise<void>
  cancelRun: () => Promise<void>
  // accepts files with the project or folders (project doesn't matter for them)
  runTests: (filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string) => Promise<void>
  updateSnapshots: (filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string) => Promise<void>

  watchTests: (filesOrDirectories?: ExtensionTestSpecification[] | string[], testNamePattern?: string) => void
  unwatchTests: () => void

  invalidateIstanbulTestModules: (modules: string[] | null) => Promise<void>
  enableCoverage: () => void
  disableCoverage: () => void
  waitForCoverageReport: () => Promise<string | null>
  close: () => void

  onFilesCreated: (files: string[]) => void
  onFilesChanged: (files: string[]) => void

  initRpc: (rpc: VitestWorkerRPC) => void
}

export interface ExtensionWorkerEvents {
  onConsoleLog: (log: UserConsoleLog) => void
  onTaskUpdate: (task: RunnerTaskResultPack[]) => void
  onTestRunEnd: (files: RunnerTestFile[], unhandledError: string, collecting?: boolean) => void
  onCollected: (file: RunnerTestFile, collecting?: boolean) => void
  onTestRunStart: (files: string[], collecting?: boolean) => void

  onProcessLog: (type: 'stdout' | 'stderr', log: string) => void
}

export type VitestExtensionRPC = BirpcReturn<ExtensionWorkerTransport, ExtensionWorkerEvents>
export type VitestWorkerRPC = BirpcReturn<ExtensionWorkerEvents, ExtensionWorkerTransport>

export interface WorkerInitMetadata {
  vitestNodePath: string
  id: string
  cwd: string
  arguments?: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
  shellType: 'terminal' | 'child_process'
  hasShellIntegration: boolean
  pnpApi?: string
  pnpLoader?: string
  setupFilePath: string
  finalCoverageFileName: string
}

export interface WorkerRunnerOptions {
  type: 'init'
  meta: WorkerInitMetadata
  debug: boolean
  astCollect: boolean
}

export interface EventReady {
  type: 'ready'
  configs: string[]
  workspaceSource: string | false
}

export interface EventDebug {
  type: 'debug'
  args: string[]
}

export interface EventError {
  type: 'error'
  error: string
}

export type WorkerEvent = EventReady | EventDebug | EventError
