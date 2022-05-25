import { workspace } from 'vscode'
import type { WorkspaceConfiguration, WorkspaceFolder } from 'vscode'
export const extensionId = 'zxch3n.vitest-explorer'

export function getConfigValue<T>(
  rootConfig: WorkspaceConfiguration,
  folderConfig: WorkspaceConfiguration,
  key: string,
  defaultValue: T,
): T {
  return folderConfig.get(key) ?? rootConfig.get(key) ?? defaultValue
}

export function getConfig(workspaceFolder: WorkspaceFolder) {
  const folderConfig = workspace.getConfiguration('vitest', workspaceFolder)
  const rootConfig = workspace.getConfiguration('vitest')

  const get = <T>(key: string, defaultValue: T) => getConfigValue<T>(rootConfig, folderConfig, key, defaultValue)

  return {
    env: get<null | Record<string, string>>('nodeEnv', null),
    commandLine: get<string | undefined>('commandLine', undefined),
    include: get<string[]>('include', []),
    exclude: get<string[]>('exclude', []),
    enable: get<boolean>('enable', false),
  }
}

export function getRootConfig() {
  const rootConfig = workspace.getConfiguration('vitest')

  return {
    showFailMessages: rootConfig.get('showFailMessages', false),
  }
}
