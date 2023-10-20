import { TextDecoder } from 'util'
import path from 'path'
import type { Uri, WorkspaceFolder } from 'vscode'
import { workspace } from 'vscode'
import minimatch from 'minimatch'
import type { ResolvedConfig } from 'vitest'
import { getCombinedConfig, getConfig } from './config'

const textDecoder = new TextDecoder('utf-8')

export const getContentFromFilesystem = async (uri: Uri) => {
  try {
    const rawContent = await workspace.fs.readFile(uri)
    return textDecoder.decode(rawContent)
  }
  catch (e) {
    console.warn(`Error providing tests for ${uri.fsPath}`, e)
    return ''
  }
}

export function shouldIncludeFile(path: string, config: ResolvedConfig) {
  const { include, exclude } = getCombinedConfig(config)
  return (
    path.startsWith(getCombinedConfig(config).root)
    && include.some(x => minimatch(path, x))
    && exclude.every(x => !minimatch(path, x, { dot: true }))
  )
}

export function getRootPath(
  workspace: WorkspaceFolder,
) {
  return path.join(workspace.uri.fsPath, getConfig(workspace).rootPath ?? '')
}

export function getTestRoot(
  workspace: WorkspaceFolder,
  config: ResolvedConfig,
) {
  const rootPath = getRootPath(workspace)
  const testRoot = getCombinedConfig(config).root
  // If this project has multiple workspaces then check that this path is in the
  // workspace that includes Vitest (this extension currently only supports a
  // single workspace with Vitest).
  if (testRoot.startsWith(rootPath) || testRoot === rootPath)
    return testRoot
}
