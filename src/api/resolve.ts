import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { findUpSync } from 'find-up'
import { getConfig } from '../config'
import { normalizeDriveLetter } from '../worker/utils'

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

  const pnp = resolveVitestPnpPackagePath(folder?.uri.fsPath || cwd)
  if (!pnp)
    return null
  return {
    vitestNodePath: pnp.vitestNodePath,
    vitestPackageJsonPath: 'vitest/package.json',
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

export function resolveVitestPnpPackagePath(cwd: string) {
  try {
    const pnpPath = findUpSync(['.pnp.js', '.pnp.cjs'], { cwd })
    if (pnpPath == null) {
      return null
    }
    const pnpApi = _require(pnpPath)
    const vitestNodePath = pnpApi.resolveRequest('vitest/node', normalizeDriveLetter(cwd))
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [dirname(pnpPath)],
      }),
      pnpPath,
      vitestNodePath,
    }
  }
  catch {
    return null
  }
}

export function resolveVitestNodePath(vitestPkgPath: string) {
  return resolve(dirname(vitestPkgPath), './dist/node.js')
}
