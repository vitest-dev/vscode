export interface WorkerInitMetadata {
  vitestNodePath: string
  id: string
  cwd: string
  arguments?: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
  shellType: 'terminal' | 'child_process'
  pnpApi?: string
  pnpLoader?: string
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

declare module 'vitest' {
  export interface ProvidedContext {
    __vscode: {
      continuousFiles: string[]
      watchEveryFile: boolean
      rerunTriggered: boolean
    }
  }
}
