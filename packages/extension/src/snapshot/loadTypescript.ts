import { createRequire } from 'node:module'
import { dirname } from 'pathe'
import type { Ts } from './types'

const typescriptCache = new Map<string, Ts | undefined>()

/**
 * Load the `typescript` package installed in the workspace so the extension does
 * not have to bundle the compiler. Returns `undefined` when it is not installed.
 *
 * Failed lookups are cached too, so a workspace without TypeScript is only probed once.
 */
export function loadWorkspaceTypescript(fromFile: string): Ts | undefined {
  const cacheKey = dirname(fromFile)
  if (typescriptCache.has(cacheKey)) return typescriptCache.get(cacheKey)

  let typescript: Ts | undefined
  try {
    typescript = createRequire(fromFile)('typescript') as Ts
  } catch {
    typescript = undefined
  }
  typescriptCache.set(cacheKey, typescript)
  return typescript
}
