import type { WorkerRunnerOptions, WorkerWSEventEmitter } from '../../packages/shared/src'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { expect } from 'chai'
import { tsImport } from 'tsx/esm/api'

it('excludes the extension plugin from the module cache without deprecation warnings', async function () {
  this.timeout(30_000)
  const vitestModule = await import('vitest/node')
  const { initVitest } = (await tsImport(
    '../../packages/worker/src/index.ts',
    __filename,
  )) as typeof import('../../packages/worker/src')
  const root = await mkdtemp(join(tmpdir(), 'vitest-vscode-cache-'))
  let stderr = ''
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      stderr += chunk.toString()
      callback()
    },
  })
  const data: WorkerRunnerOptions = {
    type: 'init',
    meta: {
      id: root,
      cwd: root,
      runtime: 'node',
      vitestNodePath: '',
      env: undefined,
      shellType: 'child_process',
      setupFilePaths: { browserDebug: '', browserDebugLegacy: '' },
      finalCoverageFileName: 'coverage.json',
    },
  }
  let vitest: Awaited<ReturnType<typeof initVitest>>['vitest'] | undefined
  try {
    const result = await initVitest(
      {
        ...vitestModule,
        createVitest: ((mode, options, viteOptions, runtimeOptions) =>
          vitestModule.createVitest(mode, { ...options, root, config: false }, viteOptions, {
            ...runtimeOptions,
            stderr: stream,
            stdout: stream,
          })) as typeof vitestModule.createVitest,
      },
      data,
      {} as WorkerWSEventEmitter,
    )
    vitest = result.vitest
    const project = vitest.projects[0]
    const plugin = project.vite.config.plugins.find((p) => p.name === 'vitest:vscode-extension')!
    // Vitest 4 must still be able to opt this plugin out of the cache key.
    expect(plugin.api.vitest.experimental.ignoreFsModuleCache).to.equal(true)
    const environment = {
      name: 'ssr',
      config: { ...project.vite.config, ...project.vite.environments.ssr.config },
    }
    const cache = (vitest as any)._fsCache ?? (vitest.cache as any)._modules
    const id = join(root, 'example.ts')
    const source = 'export const value = 1'
    const withExtension = cache.generateCachePath(project.config, environment, id, source)
    const withoutExtension = cache.generateCachePath(
      project.config,
      {
        ...environment,
        config: {
          ...environment.config,
          plugins: environment.config.plugins.filter((p) => p.name !== 'vitest:vscode-extension'),
        },
      },
      id,
      source,
    )
    expect(withExtension).to.equal(withoutExtension)
    expect(stderr).not.to.contain('api.vitest.experimental.ignoreFsModuleCache')
  } finally {
    await vitest?.close()
    await rm(root, { recursive: true, force: true })
  }
})
