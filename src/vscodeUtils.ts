import { TextDecoder } from 'node:util'
import fastGlob from 'fast-glob'
import type { ResolvedConfig } from 'vitest'
import type { Uri } from 'vscode'
import { workspace } from 'vscode'
import { relative, resolve } from 'pathe'
import micromatch from 'micromatch'

const textDecoder = new TextDecoder('utf-8')

export async function getContentFromFilesystem(uri: Uri) {
  try {
    const rawContent = await workspace.fs.readFile(uri)
    return textDecoder.decode(rawContent)
  }
  catch (e) {
    console.warn(`Error providing tests for ${uri.fsPath}`, e)
    return ''
  }
}

/**
 * @see https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/workspace.ts
 */
export function shouldIncludeFile(path: string, config: ResolvedConfig): boolean {
  const relativeId = relative(config.dir || config.root, path)
  if (micromatch.isMatch(relativeId, config.exclude))
    return false

  if (micromatch.isMatch(relativeId, config.include))
    return true

  return false
}

/**
 * @see https://github.com/vitest-dev/vitest/blob/main/packages/vitest/src/node/workspace.ts
 */
export async function globFiles(include: string[], exclude: string[], cwd: string) {
  const globOptions: fastGlob.Options = {
    dot: true,
    cwd,
    ignore: exclude,
  }

  const files = await fastGlob(include, globOptions)
  return files.map(file => resolve(cwd, file))
}
