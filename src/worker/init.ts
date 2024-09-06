import type { UserConfig } from 'vitest/node'
import { VSCodeReporter } from './reporter'
import type { WorkerMeta } from './types'

export async function initVitest(meta: WorkerMeta, options?: UserConfig) {
  const vitestModule = await import(meta.vitestNodePath) as typeof import('vitest/node')
  const reporter = new VSCodeReporter()
  const vitest = await vitestModule.createVitest(
    'test',
    {
      config: meta.configFile,
      workspace: meta.workspaceFile,
      ...meta.arguments ? vitestModule.parseCLI(meta.arguments).options : {},
      ...options,
      watch: true,
      api: false,
      // @ts-expect-error private property
      reporter: undefined,
      reporters: [reporter],
      ui: false,
      includeTaskLocation: true,
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
  reporter.init(vitest)
  return {
    vitest,
    reporter,
    meta,
  }
}
