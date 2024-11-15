export interface WorkerMeta {
  vitestNodePath: string
  id: string
  cwd: string
  arguments?: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
  pnpApi?: string
  pnpLoader?: string
}

export interface WorkerRunnerOptions {
  type: 'init'
  meta: WorkerMeta
  debug: boolean
  astCollect: boolean
}

export interface EventReady {
  type: 'ready'
  configs: string[]
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
