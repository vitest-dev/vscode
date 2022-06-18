import * as vscode from 'vscode'
import type { WorkspaceConfiguration, WorkspaceFolder } from 'vscode'
import { isVitestEnv } from './pure/isVitestEnv'
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
  const workspace = vscode.workspace
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
  const rootConfig = vscode.workspace.getConfiguration('vitest')

  return {
    showFailMessages: rootConfig.get('showFailMessages', false),
  }
}

export const vitestEnvironmentFolders: ReadonlyArray<WorkspaceFolder> = []

export async function detectVitestEnvironmentFolders() {
  const vitestFolders = vitestEnvironmentFolders as WorkspaceFolder[]
  vitestFolders.splice(0, vitestFolders.length)
  if (
    vscode.workspace.workspaceFolders == null
    || vscode.workspace.workspaceFolders.length === 0
  )
    return

  for (const folder of vscode.workspace.workspaceFolders) {
    if (await isVitestEnv(folder) || getConfig(folder).enable)
      vitestFolders.push(folder)
  }
}
