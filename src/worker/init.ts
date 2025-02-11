import { pathToFileURL } from 'node:url'
import type { UserConfig, WorkspaceProject } from 'vitest/node'
import { VSCodeReporter } from './reporter'
import type { WorkerMeta } from './types'
import { normalizeDriveLetter } from './utils'

export async function initVitest(meta: WorkerMeta, options?: UserConfig) {
  const vitestModule = await import(
    pathToFileURL(normalizeDriveLetter(meta.vitestNodePath)).toString()
  ) as typeof import('vitest/node')
  const reporter = new VSCodeReporter()
  const pnpExecArgv = meta.pnpApi && meta.pnpLoader
    ? [
        '--require',
        meta.pnpApi,
        '--experimental-loader',
        meta.pnpLoader,
      ]
    : undefined
  const args = meta.arguments
    ? vitestModule.parseCLI(meta.arguments, {
      allowUnknownOptions: false,
    }).options
    : {}
  const vitest = await vitestModule.createVitest(
    'test',
    {
      config: meta.configFile,
      ...(meta.workspaceFile ? { workspace: meta.workspaceFile } : {}),
      ...args,
      ...options,
      watch: true,
      api: false,
      // @ts-expect-error private property
      reporter: undefined,
      reporters: meta.shellType === 'terminal'
        ? [reporter, ['default', { isTTY: false }]]
        : [reporter],
      ui: false,
      includeTaskLocation: true,
      poolOptions: meta.pnpApi && meta.pnpLoader
        ? {
            threads: {
              execArgv: pnpExecArgv,
            },
            forks: {
              execArgv: pnpExecArgv,
            },
            vmForks: {
              execArgv: pnpExecArgv,
            },
            vmThreads: {
              execArgv: pnpExecArgv,
            },
          }
        : {},
    },
    {
      server: {
        middlewareMode: true,
        // when support for Vite 4 is dropped, set to `null`
        watch: {
          usePolling: true,
          ignored: ['**/*'],
          depth: 0,
          followSymlinks: false,
        },
      },
      plugins: [
        {
          name: 'vitest:vscode-extension',
          configureServer(server) {
            server.watcher.close()
          },
          configResolved(config) {
            // stub a server so Vite doesn't start a websocket connection,
            // because we don't need it in the extension and it messes up Vite dev command
            config.server.hmr = {
              server: {
                on: () => {},
                off: () => {},
              } as any,
            }
          },
        },
      ],
    },
  )
  await vitest.report('onInit', vitest)
  const configs = ([
    // @ts-expect-error -- getRootProject in Vitest 3.0
    'getRootProject' in vitest ? vitest.getRootProject() : vitest.getCoreWorkspaceProject(),
    ...vitest.projects,
  ] as WorkspaceProject[]).map(p => p.server.config.configFile).filter(c => c != null)
  return {
    vitest,
    reporter,
    configs: Array.from(new Set(configs)),
    meta,
  }
}
