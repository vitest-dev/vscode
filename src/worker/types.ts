export interface WorkerMeta {
  vitestNodePath: string
  id: string
  cwd: string
  arguments?: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
}

export interface WorkerRunnerOptions {
  type: 'init'
  meta: WorkerMeta[]
  loader?: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    __vscode: {
      continuousFiles: string[]
      watchEveryFile: boolean
      rerunTriggered: boolean
    }
  }
}
