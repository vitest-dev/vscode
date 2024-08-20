import { pathToFileURL } from 'node:url'
import type * as vscode from 'vscode'
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
  const vitestPackageJsonPath = resolveVitestPackagePath(cwd, folder)
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
    vitestNodePath: resolveVitestNodePath(pnp.vitestPath),
    vitestPackageJsonPath: pnp.vitestPath,
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
    return customPackagePath || require.resolve('vitest/package.json', {
      paths: [cwd],
    })
  }
  catch {
    return null
  }
}

export function resolveVitestPnpPackagePath(cwd: string) {
  try {
    const pnpPath = require.resolve('./.pnp.cjs', {
      paths: [cwd],
    })
    const pnp = _require(pnpPath)
    const vitestPath = pnp.resolveToUnqualified(
      'vitest/package.json',
      cwd,
    ) as string
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [cwd],
      }),
      vitestPath,
      pnpPath,
    }
  }
  catch {
    return null
  }
}

export function resolveVitestNodePath(vitestPkgPath: string) {
  return pathToFileURL(resolve(dirname(vitestPkgPath), './dist/node.js')).toString()
}
