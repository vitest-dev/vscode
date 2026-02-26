import type * as vscode from 'vscode'
import { findUpSync } from 'find-up'
import { dirname, resolve } from 'pathe'
import { getConfig } from '../config'

const _require = require

export interface VitestResolution {
  vitestPackageJsonPath: string
  vitestNodePath: string
  pnp?: {
    loaderPath: string
    pnpPath: string
  }
}

export function resolveVitestPackage(cwd: string, folder: vscode.WorkspaceFolder | undefined): VitestResolution | null {
  const vitestPackageJsonPath = !process.versions.pnp && resolveVitestPackagePath(cwd, folder)
  if (vitestPackageJsonPath) {
    return {
      vitestNodePath: resolveVitestNodePath(vitestPackageJsonPath),
      vitestPackageJsonPath,
    }
  }
  const vitePlus = resolveVitePlusPackagePath(cwd)
  if (vitePlus) {
    return {
      vitestNodePath: resolveViePlusVitestNodePath(vitePlus),
      vitestPackageJsonPath: vitePlus,
    }
  }

  const pnpCwd = folder?.uri.fsPath || cwd
  const pnp = resolvePnp(pnpCwd)
  if (!pnp)
    return null
  const vitestNodePath
    = resolvePnpPackagePath(pnp.pnpApi, 'vitest/node', pnpCwd)
      || resolvePnpPackagePath(pnp.pnpApi, 'vite-plus/test/node', pnpCwd)
  if (!vitestNodePath)
    return null
  return {
    vitestNodePath,
    vitestPackageJsonPath: '', // we don't read pkg.json for pnp
    pnp: {
      loaderPath: pnp.pnpLoader,
      pnpPath: pnp.pnpPath,
    },
  }
}

export function resolveVitestPackagePath(cwd: string, folder: vscode.WorkspaceFolder | undefined) {
  const customPackagePath = getConfig(folder).vitestPackagePath
  if (customPackagePath && !customPackagePath.endsWith('package.json'))
    throw new Error(`"vitest.vitestPackagePath" must point to a package.json file, instead got: ${customPackagePath}`)
  try {
    const result = customPackagePath || require.resolve('vitest/package.json', {
      paths: [cwd],
    })
    delete require.cache['vitest/package.json']
    delete require.cache[result]
    return result
  }
  catch {
    return null
  }
}

export function resolveVitePlusPackagePath(cwd: string) {
  try {
    const result = require.resolve('vite-plus/package.json', {
      paths: [cwd],
    })
    delete require.cache['vite-plus/package.json']
    delete require.cache[result]
    return result
  }
  catch {
    return null
  }
}

export function resolvePnp(cwd: string) {
  try {
    const pnpPath = findUpSync(['.pnp.js', '.pnp.cjs'], { cwd })
    if (pnpPath == null) {
      return null
    }
    const pnpApi = _require(pnpPath)
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [dirname(pnpPath)],
      }),
      pnpPath,
      pnpApi,
    }
  }
  catch {
    return null
  }
}

export function resolvePnpPackagePath(pnpApi: any, pkg: 'vitest/node' | 'vite-plus/test/node', cwd: string): string | null {
  try {
    const vitestNodePath = pnpApi.resolveRequest(pkg, cwd)
    return vitestNodePath
  }
  catch {
    return null
  }
}

export function resolveViePlusVitestNodePath(vitePlusPkgPath: string) {
  return resolve(dirname(vitePlusPkgPath), './dist/test/node.js')
}

export function resolveVitestNodePath(vitestPkgPath: string) {
  return resolve(dirname(vitestPkgPath), './dist/node.js')
}
