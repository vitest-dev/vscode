import type { WorkspaceConfiguration, WorkspaceFolder } from 'vscode'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import * as vscode from 'vscode'
import { configGlob } from './constants'

export const extensionId = 'vitest.explorer'
export const testControllerId = 'vitest'

export function getConfigValue<T>(
  rootConfig: WorkspaceConfiguration,
  folderConfig: WorkspaceConfiguration,
  key: string,
  defaultValue?: T,
): T | undefined {
  if (typeof defaultValue === 'boolean') {
    return folderConfig.get(key) ?? rootConfig.get(key) ?? defaultValue
  }
  return folderConfig.get(key) || rootConfig.get(key) || defaultValue
}

export function getConfig(workspaceFolder?: WorkspaceFolder) {
  if (!workspaceFolder && vscode.workspace.workspaceFolders?.length === 1)
    workspaceFolder = vscode.workspace.workspaceFolders[0]

  const folderConfig = vscode.workspace.getConfiguration('vitest', workspaceFolder)
  const rootConfig = vscode.workspace.getConfiguration('vitest')

  const get = <T>(key: string, defaultValue?: T) => getConfigValue<T>(
    rootConfig,
    folderConfig,
    key,
    defaultValue,
  )

  const nodeExecutable = get<string | undefined>('nodeExecutable')
  const workspaceConfig = get<string | undefined>('workspaceConfig')
  const rootConfigFile = get<string | undefined>('rootConfig')

  const configSearchPatternExclude = get<string>(
    'configSearchPatternExclude',
    '{**/node_modules/**,**/vendor/**,**/.*/**,**/*.d.ts}',
  )!

  const configSearchPatternInclude = get<string>(
    'configSearchPatternInclude',
    configGlob,
  ) || configGlob

  const vitestPackagePath = get<string | undefined>('vitestPackagePath')
  const resolvedVitestPackagePath = workspaceFolder && vitestPackagePath
    ? resolve(
        workspaceFolder.uri.fsPath,
        // eslint-disable-next-line no-template-curly-in-string
        vitestPackagePath.replace('${workspaceFolder}', workspaceFolder.uri.fsPath),
      )
    : vitestPackagePath

  const logLevel = get<string>('logLevel', 'info')

  const filesWatcherInclude = get<string>('filesWatcherInclude', '**/*')!

  const terminalShellArgs = get<string[] | undefined>('terminalShellArgs')
  const terminalShellPath = get<string | undefined>('terminalShellPath')
  const shellType = get<'child_process' | 'terminal'>('shellType', 'child_process')!
  const nodeExecArgs = get<string[] | undefined>('nodeExecArgs')

  const experimentalStaticAstCollect = get<boolean>('experimentalStaticAstCollect', false)!

  const cliArguments = get<string | undefined>('cliArguments')

  const debugOutFiles = get<string[]>('debugOutFiles', [])
  const applyDiagnostic = get<boolean>('applyDiagnostic', true)
  const ignoreWorkspace = get<boolean>('ignoreWorkspace', false) ?? false

  return {
    env: get<null | Record<string, string>>('nodeEnv', null),
    debugEnv: get<null | Record<string, string>>('debugNodeEnv', null),
    debugExclude: get<string[]>('debugExclude'),
    debugOutFiles,
    filesWatcherInclude,
    terminalShellArgs,
    terminalShellPath,
    shellType,
    applyDiagnostic,
    cliArguments,
    nodeExecArgs,
    experimentalStaticAstCollect,
    vitestPackagePath: resolvedVitestPackagePath,
    workspaceConfig: resolveConfigPath(workspaceConfig),
    rootConfig: resolveConfigPath(rootConfigFile),
    configSearchPatternInclude,
    configSearchPatternExclude,
    ignoreWorkspace,
    maximumConfigs: get<number>('maximumConfigs', 5),
    nodeExecutable: resolveConfigPath(nodeExecutable),
    disableWorkspaceWarning: get<boolean>('disableWorkspaceWarning', false),
    debuggerPort: get<number>('debuggerPort') || undefined,
    debuggerAddress: get<string>('debuggerAddress', undefined) || undefined,
    logLevel,
    showImportsDuration: get<boolean>('showImportsDuration', true) ?? true,
  }
}

export function resolveConfigPath(path: string | undefined) {
  if (!path || isAbsolute(path))
    return path
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2))
  }
  // if there is a workspace file, then it should be relative to it because
  // this option cannot be configured on a workspace folder level
  if (vscode.workspace.workspaceFile)
    return resolve(dirname(vscode.workspace.workspaceFile.fsPath), path)
  const workspaceFolders = vscode.workspace.workspaceFolders
  // if there is no workspace file, then it's probably a single folder workspace
  if (workspaceFolders?.length === 1)
    return resolve(workspaceFolders[0].uri.fsPath, path)
  // if there are still several folders, then we can't reliably resolve the path
  return path
}
