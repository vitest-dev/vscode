import { dirname, resolve } from 'node:path'
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

  const nodeExecutable = get<string | undefined>('nodeExecutable')

  return {
    env: get<null | Record<string, string>>('nodeEnv', null),
    debugExclude: get<string[]>('debugExclude', []),
    packagePath: get<string | undefined>('packagePath'),
    nodeExecutable: resolveNodeExecutable(nodeExecutable),
    disableWorkspaceWarning: get<boolean>('disableWorkspaceWarning', false),
  }
}

function resolveNodeExecutable(nodeExecutable: string | undefined) {
  if (!nodeExecutable)
    return nodeExecutable
  // if there is a workspace file, then it should be relative to it because
  // this option cannot be configured on a workspace folder level
  if (vscode.workspace.workspaceFile)
    return resolve(dirname(vscode.workspace.workspaceFile.fsPath), nodeExecutable)
  const workspaceFolders = vscode.workspace.workspaceFolders
  // if there is no workspace file, then it's probably a single folder workspace
  if (workspaceFolders?.length === 1)
    return resolve(workspaceFolders[0].uri.fsPath, nodeExecutable)
  // if there are still several folders, then we can't reliably resolve the path
  return nodeExecutable
}
