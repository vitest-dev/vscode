import type { ResolvedBrowserOptions } from 'vitest/dist/node.js'

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
  browserDebugOptions: BrowserDebugOptions[] | undefined
}

export type BrowserDebugOptions = Pick<ResolvedBrowserOptions, 'enabled' | 'provider'> & { project: string }

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
