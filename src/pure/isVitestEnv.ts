import { existsSync } from 'fs'
import path = require('path')
import { readFile, readdir } from 'fs-extra'
import type { WorkspaceFolder } from 'vscode'
import { getVitestPath } from './utils'

export async function isDefinitelyVitestEnv(projectRoot: string | WorkspaceFolder): Promise<boolean> {
  if (typeof projectRoot !== 'string')
    return isDefinitelyVitestEnv(projectRoot.uri.fsPath)

  if (getVitestPath(projectRoot))
    return true

  if (!existsSync(path.join(projectRoot, 'package.json')))
    return false

  const pkgPath = path.join(projectRoot, 'package.json') as string
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as any
  if (existsSync(pkg)) {
    if (pkg.devDependencies && pkg.devDependencies.vitest)
      return true

    if (pkg.dependencies && pkg.dependencies.vitest)
      return true
  }

  if (
    existsSync(path.join(projectRoot, 'vitest.config.js'))
    || existsSync(path.join(projectRoot, 'vitest.config.ts'))
  )
    return true

  // monorepo
  if (existsSync(path.join(projectRoot, 'packages'))) {
    const dirs = await readdir(path.join(projectRoot, 'packages'))
    for (const dir of dirs) {
      if (await isDefinitelyVitestEnv(dir))
        return true
    }
  }

  return false
}

export async function mayBeVitestEnv(projectRoot: string | WorkspaceFolder): Promise<boolean> {
  if (typeof projectRoot !== 'string')
    return mayBeVitestEnv(projectRoot.uri.fsPath)

  if (getVitestPath(projectRoot))
    return true

  if (!existsSync(path.join(projectRoot, 'package.json')))
    return false

  const pkgPath = path.join(projectRoot, 'package.json') as string
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as any
    if (pkg.devDependencies && pkg.devDependencies.vitest)
      return true

    if (pkg.dependencies && pkg.dependencies.vitest)
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
    for (const dir of dirs) {
      if (await mayBeVitestEnv(dir))
        return true
    }
  }

  return false
}
