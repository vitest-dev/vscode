import { TextDecoder } from 'util'
import type { Uri } from 'vscode'
import { workspace } from 'vscode'
import minimatch from 'minimatch'
import type { ResolvedConfig } from 'vitest'
import { getCombinedConfig } from './config'

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
    include.some(x => minimatch(path, x))
    && exclude.every(x => !minimatch(path, x, { dot: true }))
  )
}
