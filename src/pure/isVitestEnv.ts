import { existsSync } from 'fs'
import path = require('path')
import { readFile, readdir } from 'fs-extra'
import { getVitestPath } from './utils'

export async function isVitestEnv(projectRoot: string): Promise<boolean> {
  if (getVitestPath(projectRoot))
    return true

  const pkgPath = path.join(projectRoot, 'package.json') as string
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as any
  if (existsSync(pkg)) {
    if (pkg.devDependencies && pkg.devDependencies.vitest)
      return true

    if (pkg.devDependencies && pkg.devDependencies.jest)
      return false
  }

  if (
    existsSync(path.join(projectRoot, 'vite.config.js'))
    || existsSync(path.join(projectRoot, 'vite.config.ts'))
    || existsSync(path.join(projectRoot, 'vitest.config.js'))
    || existsSync(path.join(projectRoot, 'vitest.config.ts'))
  )
    return true

  if (existsSync(path.join(projectRoot, 'jest.config.js')))
    return false

  // monorepo
  if (existsSync(path.join(projectRoot, 'packages'))) {
    const dirs = await readdir(path.join(projectRoot, 'packages'))
    return dirs.some(dir => isVitestEnv(dir))
  }

  return false
}
