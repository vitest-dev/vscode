import { existsSync, readFileSync } from 'node:fs'
import * as vscode from 'vscode'
import { basename, dirname, normalize, resolve } from 'pathe'
import { gte } from 'semver'
import { log } from '../log'
import { configGlob, minimumVersion, workspaceGlob } from '../constants'
import { getConfig } from '../config'
import { resolveVitestPackage } from './resolve'

const _require = require

function nonNullable<T>(value: T | null | undefined): value is T {
  return value != null
}

export interface VitestPackage {
  folder: vscode.WorkspaceFolder
  prefix: string
  vitestNodePath: string
  vitestPackageJsonPath: string
  // path to a config file or a workspace config file
  id: string
  cwd: string
  version: string
  arguments?: string
  configFile?: string
  workspaceFile?: string
  loader?: string
  pnp?: string
}

function isVitestInPackageJson(root: string) {
  const pkgJson = resolve(dirname(root), 'package.json')
  if (existsSync(pkgJson)) {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf-8'))
    return pkg.dependencies?.vitest || pkg.devDependencies?.vitest
  }
  return false
}

function resolveVitestConfig(showWarning: boolean, configOrWorkspaceFile: vscode.Uri): VitestPackage | null {
  const folder = vscode.workspace.getWorkspaceFolder(configOrWorkspaceFile)!
  if (!folder)
    throw new Error(`Workspace folder not found for ${configOrWorkspaceFile}. Does the file exist?`)

  const cwd = dirname(configOrWorkspaceFile.fsPath)
  const vitest = resolveVitestPackage(dirname(configOrWorkspaceFile.fsPath), folder)

  if (!vitest) {
    if (showWarning) {
      const isVitestConfig = configOrWorkspaceFile.fsPath.includes('vitest.')
      if (isVitestConfig || isVitestInPackageJson(folder.uri.fsPath))
        vscode.window.showWarningMessage(`Vitest not found in "${basename(dirname(configOrWorkspaceFile.fsPath))}" folder. Please run \`npm i --save-dev vitest\` to install Vitest.'`)
    }
    log.error('[API]', `Vitest not found for ${configOrWorkspaceFile}.`)
    return null
  }

  const id = normalize(configOrWorkspaceFile.fsPath)
  const prefix = `${basename(dirname(id))}:${basename(id)}`

  if (vitest.pnp) {
    return {
      folder,
      id,
      cwd,
      prefix,
      vitestNodePath: vitest.vitestNodePath,
      vitestPackageJsonPath: vitest.vitestPackageJsonPath,
      version: 'pnp',
      loader: vitest.pnp.loaderPath,
      pnp: vitest.pnp.pnpPath,
    }
  }

  const pkg = _require(vitest.vitestPackageJsonPath)
  if (!validateVitestPkg(showWarning, vitest.vitestPackageJsonPath, pkg))
    return null

  return {
    folder,
    id,
    cwd,
    prefix,
    vitestPackageJsonPath: vitest.vitestPackageJsonPath,
    vitestNodePath: vitest.vitestNodePath,
    version: pkg.version,
  }
}

function validateVitestPkg(showWarning: boolean, pkgJsonPath: string, pkg: any) {
  if (pkg.name !== 'vitest') {
    vscode.window.showErrorMessage(
      `Package was resolved to "${pkg.name}" instead of "vitest". If you are using "vitest.vitestPackagePath", make sure it points to a "vitest" package.`,
    )
    delete require.cache[pkgJsonPath]
    return false
  }
  if (!gte(pkg.version, minimumVersion)) {
    const warning = `Vitest v${pkg.version} is not supported. Vitest v${minimumVersion} or newer is required.`
    if (showWarning)
      vscode.window.showWarningMessage(warning)
    else
      log.error('[API]', `Vitest v${pkg.version} from ${pkgJsonPath} is not supported. Vitest v${minimumVersion} or newer is required.`)
    delete require.cache[pkgJsonPath]
    return false
  }
  return true
}

export async function resolveVitestPackages(showWarning: boolean): Promise<{ configs: VitestPackage[]; workspaces: VitestPackage[] }> {
  // TODO: update "warned" logic
  const [workspaceConfigs, configs] = await Promise.all([
    resolveVitestWorkspaceConfigs(showWarning),
    resolveVitestConfigs(showWarning),
  ])
  if (!workspaceConfigs.meta.length && !configs.meta.length) {
    const pkg = await resolveVitestPackagesViaPackageJson(showWarning)
    if (!pkg.meta.length && !pkg.warned)
      return { configs: resolveVitestWorkspacePackages(showWarning).meta, workspaces: [] }
    return { configs: pkg.meta, workspaces: [] }
  }
  return {
    workspaces: workspaceConfigs.meta,
    configs: configs.meta,
  }
}

function resolveVitestWorkspacePackages(showWarning: boolean) {
  let warned = false
  const meta: VitestPackage[] = []
  vscode.workspace.workspaceFolders?.forEach((folder) => {
    const cwd = normalize(folder.uri.fsPath)
    const vitest = resolveVitestPackage(cwd, folder)
    if (!vitest)
      return

    const pkg = _require(vitest.vitestPackageJsonPath)
    if (!validateVitestPkg(showWarning, vitest.vitestPackageJsonPath, pkg)) {
      warned = true
      return
    }
    const id = normalize(folder.uri.fsPath)
    const prefix = `${basename(cwd)}:${basename(id)}`
    meta.push({
      folder,
      id,
      cwd,
      prefix,
      vitestPackageJsonPath: vitest.vitestPackageJsonPath,
      vitestNodePath: vitest.vitestNodePath,
      version: pkg.version,
    })
  })
  return {
    meta,
    warned,
  }
}

export async function resolveVitestPackagesViaPackageJson(showWarning: boolean): Promise<{ meta: VitestPackage[]; warned: boolean }> {
  const config = getConfig()

  const packages = await vscode.workspace.findFiles(
    '**/package.json',
    config.configSearchPatternExclude,
  )

  let warned = false
  const meta: VitestPackage[] = []
  packages.forEach((pkgPath) => {
    const scripts = Object.entries(_require(pkgPath.fsPath).scripts || {}).filter(([, script]) => {
      return typeof script === 'string' && script.startsWith('vitest ')
    }) as [string, string][]

    if (!scripts.length)
      return

    const folder = vscode.workspace.getWorkspaceFolder(pkgPath)!
    const cwd = dirname(pkgPath.fsPath)
    const vitest = resolveVitestPackage(cwd, folder)

    // skip if Vitest is not installed
    if (!vitest)
      return

    const pkg = _require(vitest.vitestPackageJsonPath)
    if (!validateVitestPkg(showWarning, vitest.vitestPackageJsonPath, pkg)) {
      warned = true
      return
    }

    // take only the fist script to not pollute the list
    const scriptOption = scripts[0]

    if (!scriptOption)
      return

    const [scriptName, script] = scriptOption

    const id = `${normalize(pkgPath.fsPath)}/${scriptName}`
    const prefix = `${basename(cwd)}/package.json:${scriptName}`
    meta.push({
      folder,
      id,
      cwd,
      prefix,
      arguments: script,
      vitestPackageJsonPath: vitest.vitestPackageJsonPath,
      vitestNodePath: vitest.vitestNodePath,
      version: pkg.version,
    })
  })

  return {
    meta: resolvePackagUniquePrefixes(meta),
    warned,
  }
}

async function resolveVitestWorkspaceConfigs(showWarning: boolean) {
  const config = getConfig()
  const userWorkspace = config.workspaceConfig
  const rootConfig = config.rootConfig

  if (userWorkspace)
    log.info('[API] Using user workspace config:', userWorkspace)

  const vitestWorkspaces = userWorkspace
    ? [vscode.Uri.file(userWorkspace)]
    : await vscode.workspace.findFiles(workspaceGlob, config.configSearchPatternExclude)

  let warned = false
  if (vitestWorkspaces.length) {
    // if there is a workspace config, use it as root
    const meta = resolvePackagUniquePrefixes(vitestWorkspaces.map((config) => {
      const vitest = resolveVitestConfig(showWarning, config)
      if (!vitest) {
        warned = true
        return null
      }
      return {
        ...vitest,
        configFile: rootConfig,
        workspaceFile: vitest.id,
      }
    }).filter(nonNullable))

    return {
      meta,
      warned,
    }
  }
  return {
    meta: [],
    warned,
  }
}

async function resolveVitestConfigs(showWarning: boolean) {
  const config = getConfig()
  const rootConfig = config.rootConfig

  let warned = false

  if (rootConfig)
    log.info('[API] Using user root config:', rootConfig)

  const configs = rootConfig
    ? [vscode.Uri.file(rootConfig)]
    : await vscode.workspace.findFiles(configGlob, config.configSearchPatternExclude)

  const configsByFolder = configs.reduce<Record<string, vscode.Uri[]>>((acc, config) => {
    const dir = dirname(config.fsPath)
    if (!acc[dir])
      acc[dir] = []
    acc[dir].push(config)
    return acc
  }, {})

  const resolvedMeta: VitestPackage[] = []

  for (const [_, configFiles] of Object.entries(configsByFolder)) {
    // vitest config always overrides vite config - if there is a Vitest config, we assume vite was overriden,
    // but it's possible to have several Vitest configs (vitest.e2e. vitest.unit, etc.)
    const hasViteAndVitestConfig = configFiles.some(file => basename(file.fsPath).includes('vite.'))
      && configFiles.some(file => basename(file.fsPath).includes('vitest.'))
    // remove all vite configs from a folder if there is at least one Vitest config
    const filteredConfigFiles = hasViteAndVitestConfig
      ? configFiles.filter(file => !basename(file.fsPath).includes('vite.'))
      : configFiles
    filteredConfigFiles.forEach((config) => {
      const vitest = resolveVitestConfig(showWarning, config)
      if (vitest) {
        resolvedMeta.push({
          ...vitest,
          configFile: vitest.id,
        })
      }
      else {
        warned = true
      }
    })
  }

  return {
    meta: resolvePackagUniquePrefixes(resolvedMeta),
    warned,
  }
}

export function findFirstUniqueFolderNames(paths: string[]) {
  const folders: string[] = []
  const mapCount: Record<string, number> = {}
  const segments = paths.map(p => p.split('/').reverse().slice(2))

  paths.forEach((_, index) => {
    segments[index].forEach((str) => {
      if (!str)
        return
      mapCount[str] = (mapCount[str] || 0) + 1
    })
  })

  paths.forEach((_, index) => {
    let minCount = Number.POSITIVE_INFINITY
    let folder = ''

    segments[index].forEach((str) => {
      // in case the count is the same and we already used it, ignore it
      if (mapCount[str] < minCount && !folders.includes(str)) {
        minCount = mapCount[str]
        folder = str
      }
    })

    mapCount[folder]++
    folders.push(folder)
  })

  return folders
}

function resolvePackagUniquePrefixes(packages: VitestPackage[]) {
  const prefixes: Record<string, string[]> = {}
  const projects: Record<string, VitestPackage> = {}
  for (const pkg of packages) {
    const { prefix, id } = pkg
    if (!prefixes[prefix])
      prefixes[prefix] = []
    prefixes[prefix].push(id)
    projects[id] = pkg
  }

  for (const prefix in prefixes) {
    const paths = prefixes[prefix]
    if (paths.length === 1)
      continue

    const folders = findFirstUniqueFolderNames(paths)
    paths.forEach((path, index) => {
      const config = basename(path)
      const folder = folders[index]
      projects[path].prefix = `${folder}:${config}`
    })
  }

  return packages
}
