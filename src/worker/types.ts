export interface WorkerMeta {
  vitestNodePath: string
  id: string
  configFile?: string
  workspaceFile?: string
  env: Record<string, any> | undefined
}

export interface WorkerRunnerOptions {
  type: 'init'
  meta: WorkerMeta[]
  loader?: string
}
