import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import type * as vscode from 'vscode'
import { dirname, resolve } from 'pathe'
import { getConfig } from '../config'

const _require = require

interface VitestPackage {
  vitestPackageJsonPath: string
  vitestNodePath: string
  pnp?: {
    loaderPath: string
    pnpPath: string
  }
}

export function resolveVitestPackage(cwd: string, folder: vscode.WorkspaceFolder): VitestPackage | null {
  const vitestPackageJsonPath = resolveVitestPackagePath(cwd, folder)
  if (vitestPackageJsonPath) {
    return {
      vitestNodePath: resolveVitestNodePath(vitestPackageJsonPath),
      vitestPackageJsonPath,
    }
  }

  const pnp = resolveVitestPnpPackagePath(folder)
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

export function resolveVitestPackagePath(cwd: string, folder: vscode.WorkspaceFolder) {
  const customPackagePath = getConfig(folder).vitestPackagePath
  if (existsSync(`${cwd}/.pnp.cjs`))
    return null
  if (customPackagePath && !customPackagePath.endsWith('package.json'))
    throw new Error(`"vitest.vitestPackagePath" must point to a package.json file, instead got: ${customPackagePath}`)
  try {
    return customPackagePath || require.resolve('vitest/package.json', {
      paths: [cwd],
    })
  }
  catch (_) {
    return null
  }
}

export function resolveVitestPnpPackagePath(folder: vscode.WorkspaceFolder) {
  try {
    const pnpPath = require.resolve('./.pnp.cjs', {
      paths: [folder.uri.fsPath],
    })
    const pnp = _require(pnpPath)
    const vitestPath = pnp.resolveVirtual(pnp.resolveToUnqualified(
      'vitest/package.json',
      folder.uri.fsPath,
    ))
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [folder.uri.fsPath],
      }),
      vitestPath,
      pnpPath,
    }
  }
  catch (_) {
    return null
  }
}

export function resolveVitestNodePath(vitestPkgPath: string) {
  return pathToFileURL(resolve(dirname(vitestPkgPath), './dist/node.js')).toString()
}
