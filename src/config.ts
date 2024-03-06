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

  const get = <T>(key: string, defaultValue?: T) => getConfigValue<T>(rootConfig, folderConfig, key, defaultValue)

  return {
    env: get<null | Record<string, string>>('nodeEnv', null),
    commandLine: get<string | undefined>('commandLine', undefined),
    watchOnStartup: get<boolean>('watchOnStartup', false),
    enable: get<boolean>('enable', true),
    debugExclude: get<string[]>('debugExclude', []),
  }
}

export function getRootConfig() {
  const rootConfig = vscode.workspace.getConfiguration('vitest')

  return {
    showFailMessages: rootConfig.get('showFailMessages', false),
    changeBackgroundColor: rootConfig.get('changeBackgroundColor', true),
    disabledWorkspaceFolders: rootConfig.get<string[]>('disabledWorkspaceFolders', []),
  }
}
