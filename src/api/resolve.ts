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
    const pnpApi = _require(pnpPath)
    const vitestNodePath = pnpApi.resolveRequest('vitest/node', normalizeDriveLetter(cwd))
    return {
      pnpLoader: require.resolve('./.pnp.loader.mjs', {
        paths: [cwd],
      }),
      pnpPath,
      vitestNodePath,
    }
  }
  catch {
    return null
  }
}

function normalizeDriveLetter(path: string) {
  if (process.platform !== 'win32')
    return path
  // "path" always has the uppercase drive letter
  // but the drive letter in the path might be lowercase
  // so we need to normalize it, otherwise yarn pnp resolution will fail
  const currentDriveLetter = __dirname[0]
  const letterCase = currentDriveLetter === currentDriveLetter.toUpperCase()
    ? 'uppercase'
    : 'lowercase'
  const targetDriveLetter = path[0]
  if (letterCase === 'lowercase') {
    const driveLetter = targetDriveLetter.toLowerCase()
    return driveLetter + path.slice(1)
  }
  const driveLetter = targetDriveLetter.toUpperCase()
  return driveLetter + path.slice(1)
}

export function resolveVitestNodePath(vitestPkgPath: string) {
  return resolve(dirname(vitestPkgPath), './dist/node.js')
}
