import type { WorkspaceConfiguration, WorkspaceFolder } from 'vscode'
import * as vscode from 'vscode'

export const extensionId = 'vitest.explorer'
export const testControllerId = 'vitest'

export function getConfigValue<T>(
  rootConfig: WorkspaceConfiguration,
  folderConfig: WorkspaceConfiguration,
  key: string,
  defaultValue?: T,
): T | undefined {
  return folderConfig.get(key) ?? rootConfig.get(key) ?? defaultValue
}

export function getConfig(workspaceFolder?: WorkspaceFolder | vscode.Uri | string) {
  let workspace: WorkspaceFolder | vscode.Uri | undefined
  if (typeof workspaceFolder === 'string')
    workspace = vscode.Uri.from({ scheme: 'file', path: workspaceFolder })
  else
    workspace = workspaceFolder

  const folderConfig = vscode.workspace.getConfiguration('vitest', workspace)
  const rootConfig = vscode.workspace.getConfiguration('vitest')

  const get = <T>(key: string, defaultValue?: T) => getConfigValue<T>(
    rootConfig,
    folderConfig,
    key,
    defaultValue,
  )

  return {
    env: get<null | Record<string, string>>('nodeEnv', null),
    debugExclude: get<string[]>('debugExclude', []),
    packagePath: get<string | undefined>('packagePath'),
    nodeExecutable: get<string | undefined>('nodeExecutable'),
    disableWorkspaceWarning: get<boolean>('disableWorkspaceWarning', false),
  }
}
