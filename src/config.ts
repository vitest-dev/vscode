import * as vscode from 'vscode'
import semver from 'semver'
import type { WorkspaceConfiguration, WorkspaceFolder } from 'vscode'
import type { ResolvedConfig } from 'vitest'
import { isDefinitelyVitestEnv, mayBeVitestEnv } from './pure/isVitestEnv'
import { getVitestCommand, getVitestVersion, isNodeAvailable } from './pure/utils'
import { log } from './log'
export const extensionId = 'zxch3n.vitest-explorer'

// Copied from https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/defaults.ts
// "import { configDefaults } from 'vitest'" throws unexpected URL error
const defaultInclude = ['**/*.{test,spec}.?(c|m)[jt]s?(x)']
const defaultExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
]

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
    include: get<string[]>('include'),
    exclude: get<string[]>('exclude'),
    enable: get<boolean>('enable', false),
    debugExclude: get<string[]>('debugExclude', []),
  }
}

export function getCombinedConfig(config: ResolvedConfig, workspaceFolder?: WorkspaceFolder | vscode.Uri | string) {
  const vitestConfig = getConfig(workspaceFolder)
  return {
    exclude: vitestConfig.exclude?.concat(config.exclude) || defaultExclude,
    include: vitestConfig.include?.concat(config.include) || defaultInclude,
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
    if ((await mayBeVitestEnv(folder) || getConfig(folder).enable) && !getRootConfig().disabledWorkspaceFolders.includes(folder.name))
      vitestFolders.push(folder)
  }
}

export interface VitestWorkspaceConfig {
  workspace: vscode.WorkspaceFolder
  isUsingVitestForSure: boolean
  cmd: string
  args: string[]
  version?: string
  isCompatible: boolean
  isDisabled: boolean
}

export async function getVitestWorkspaceConfigs(): Promise<VitestWorkspaceConfig[]> {
  return await Promise.all(vitestEnvironmentFolders.map(async (workspace) => {
    const cmd = getVitestCommand(workspace.uri.fsPath)
    const isUsingVitestForSure = getConfig(workspace).enable || await isDefinitelyVitestEnv(workspace) || (!!cmd)

    const version = cmd == null
      ? undefined
      : await getVitestVersion(cmd, getConfig(workspace).env || undefined).catch(async (e) => {
        log.info(e.toString())
        log.info(`process.env.PATH = ${process.env.PATH}`)
        log.info(`vitest.nodeEnv = ${JSON.stringify(getConfig(workspace).env)}`)
        let errorMsg = e.toString()
        if (!isNodeAvailable(getConfig(workspace).env || undefined)) {
          log.info('Cannot spawn node process')
          errorMsg += 'Cannot spawn node process. Please try setting vitest.nodeEnv as {"PATH": "/path/to/node"} in your settings.'
        }

        log.error(errorMsg)
        return undefined
      })

    const disabled = getRootConfig().disabledWorkspaceFolders
    const out: VitestWorkspaceConfig = cmd
      ? {
          workspace,
          version,
          isUsingVitestForSure,
          cmd: cmd.cmd,
          args: cmd.args,
          isCompatible: isCompatibleVitestConfig({ version, workspace }),
          isDisabled: disabled.includes(workspace.name),
        }
      : {
          version,
          workspace,
          isUsingVitestForSure,
          cmd: 'npx',
          args: ['vitest'],
          isCompatible: isCompatibleVitestConfig({ version, workspace }),
          isDisabled: disabled.includes(workspace.name),
        }
    return out
  }))
}

function isCompatibleVitestConfig(config: Pick<VitestWorkspaceConfig, 'version' | 'workspace'>) {
  return !!((config.version && semver.gte(config.version, '0.12.0')) || getConfig(config.workspace).commandLine)
}

/**
 * @returns vitest workspaces filtered by `disabledWorkspaceFolders`
 */
export function getValidWorkspaces(workspaces: vscode.WorkspaceFolder[]): vscode.WorkspaceFolder[] {
  const { disabledWorkspaceFolders } = getRootConfig()
  return workspaces.filter(workspace => !disabledWorkspaceFolders.includes(workspace.name)) || []
}
