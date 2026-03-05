import type { ExtensionTestSpecification, ModuleDefinitionDurationsDiagnostic } from 'vitest-vscode-shared'
import type * as vscode from 'vscode'
import type { VitestPackage } from './spawn/pkg'
import { dirname, isAbsolute } from 'node:path'
import { normalize, relative } from 'pathe'
import { VitestProcessAPI, VitestProjectConfig, withProcess } from './apiProcess'
import { log } from './log'
import { showVitestError } from './utils'

export class VitestAPI {
  constructor(
    public readonly processes: VitestProcessAPI[],
  ) {}

  async getSourceModuleDiagnostic(moduleId: string) {
    const allDiagnostic = await Promise.all(
      this.processes.map(api => api.getSourceModuleDiagnostic(moduleId)),
    )
    const modules = allDiagnostic[0]?.modules || []
    const untrackedModules = allDiagnostic[0]?.untrackedModules || []

    type TimeDiagnostic = Pick<ModuleDefinitionDurationsDiagnostic, 'selfTime' | 'totalTime' | 'transformTime' | 'resolvedId'>
    const aggregateModules = (aggregatedModule: TimeDiagnostic, currentMod: TimeDiagnostic) => {
      if (aggregatedModule.resolvedId === currentMod.resolvedId) {
        aggregatedModule.selfTime += currentMod.selfTime
        aggregatedModule.totalTime += currentMod.totalTime
        if (aggregatedModule.transformTime != null && currentMod.transformTime != null) {
          aggregatedModule.transformTime += currentMod.transformTime
        }
      }
    }

    // aggregate time from _other_ diagnostics that could've potentially imported this file
    for (let i = 1; i < allDiagnostic.length; i++) {
      const currentDiagnostic = allDiagnostic[i]
      currentDiagnostic.modules.forEach((mod, index) => {
        const aggregatedModule = modules[index]

        aggregateModules(aggregatedModule, mod)
      })
      currentDiagnostic.untrackedModules.forEach((mod, index) => {
        const aggregatedModule = untrackedModules[index]

        aggregateModules(aggregatedModule, mod)
      })
    }

    return {
      modules,
      untrackedModules,
    }
  }

  getModuleEnvironments(moduleId: string) {
    return Promise.all(
      this.processes.map(async (api) => {
        return {
          api,
          projects: await api.getModuleEnvironments(moduleId),
        }
      }),
    )
  }

  async dispose() {
    await Promise.all(this.processes.map(api => api.dispose()))
  }
}

export async function resolveVitestAPI(
  workspaceConfigs: VitestPackage[],
  configs: VitestPackage[],
  cancelToken: vscode.CancellationToken | undefined,
  onResolved?: (result: DiscoveryResult) => void,
) {
  const usedConfigs = new Set<string>()
  const workspacePromises = workspaceConfigs.map(pkg => createVitestProcessAPI(usedConfigs, pkg))

  if (workspacePromises.length) {
    log.info('[API]', `Resolving workspace configs: ${workspaceConfigs.map(p => relative(p.folder.uri.fsPath, p.id)).join(', ')}`)
  }

  const resolvedApisPromises = await Promise.allSettled(workspacePromises)
  const errors: unknown[] = []
  const results: DiscoveryResult[] = []
  for (const result of resolvedApisPromises) {
    if (result.status === 'fulfilled') {
      results.push(result.value)
      onResolved?.(result.value)
    }
    else {
      errors.push(result.reason)
    }
  }

  const configsToResolve = configs.filter((pkg) => {
    return !pkg.configFile || pkg.workspaceFile || !usedConfigs.has(pkg.configFile)
  }).sort((a, b) => {
    const depthA = a.id.split('/').length
    const depthB = b.id.split('/').length
    return depthA - depthB
  })

  const workspaceRoots: string[] = results
    .map(r => r.api.workspaceSource ? dirname(r.api.workspaceSource) : null)
    .filter(r => r != null)

  if (configsToResolve.length) {
    log.info('[API]', `Resolving configs: ${configsToResolve.map(p => relative(dirname(p.cwd), p.id)).join(', ')}`)
  }

  // one by one because it's possible some of them have "workspace:" -- the configs are already sorted by priority
  for (const pkg of configsToResolve) {
    // if the config is used by the workspace, ignore the config
    if (pkg.configFile && usedConfigs.has(pkg.configFile)) {
      log.info('[API]', `Ignoring config ${relative(dirname(pkg.cwd), pkg.id)} because it's already used by the workspace`)
      continue
    }

    // if the config is defined in the directory that is covered by the workspace, ignore the config
    if (pkg.configFile && isCoveredByWorkspace(workspaceRoots, pkg.configFile)) {
      log.info('[API]', `Ignoring config ${relative(dirname(pkg.cwd), pkg.id)} because there is a workspace config in the parent folder`)
      continue
    }

    try {
      const result = await createVitestProcessAPI(usedConfigs, pkg)
      results.push(result)
      onResolved?.(result)
      if (result.api.workspaceSource) {
        workspaceRoots.push(dirname(result.api.workspaceSource))
      }
    }
    catch (err: unknown) {
      errors.push(err)
    }

    if (cancelToken?.isCancellationRequested) {
      break
    }
  }

  if (!results.length) {
    log.error('There were errors during config load.')
    errors.forEach(e => log.error(e))
    throw new Error('The extension could not load any config.')
  }
  else if (errors.length) {
    log.error('There were errors during config load.')
    errors.forEach(e => log.error(e))
    showVitestError('The extension could not load some configs')
  }

  return new VitestAPI(results.map(r => r.api))
}

function isCoveredByWorkspace(workspacesRoots: string[], currentConfig: string): boolean {
  return workspacesRoots.some((root) => {
    const relative_ = relative(root, currentConfig)
    return !relative_.startsWith('..') && !isAbsolute(relative_)
  })
}

export interface DiscoveryResult {
  api: VitestProcessAPI
  files: import('vitest-vscode-shared').ExtensionTestFileSpecification[]
}

async function createVitestProcessAPI(usedConfigs: Set<string>, pkg: VitestPackage): Promise<DiscoveryResult> {
  return withProcess(pkg, {}, async (meta) => {
    meta.projects.forEach((project) => {
      if (project.config) {
        usedConfigs.add(project.config)
      }
    })
    const files = await meta.rpc.getFiles()
    const config = new VitestProjectConfig(pkg, meta.projects, meta.workspaceSource)
    const api = new VitestProcessAPI(config)
    return { api, files }
  })
}

export function normalizeSpecs(specs?: string[] | ExtensionTestSpecification[]) {
  if (!specs) {
    return specs
  }
  return specs.map((spec) => {
    if (typeof spec === 'string') {
      return normalize(spec)
    }
    return [spec[0], normalize(spec[1])] as ExtensionTestSpecification
  }) as string[] | ExtensionTestSpecification[]
}
