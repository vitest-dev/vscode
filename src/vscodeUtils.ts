import minimatch from 'minimatch'
import { TextDecoder } from 'util'
import type { ResolvedConfig } from 'vitest'
import type { Uri } from 'vscode'
import { workspace } from 'vscode'

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
  const { include, exclude } = config
  return (
    include.some(x => minimatch(path, x))
    && exclude.every(x => !minimatch(path, x, { dot: true }))
  )
}
