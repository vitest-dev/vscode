import { pathToFileURL } from 'node:url'
import type { UserConfig } from 'vitest/node'
import { VSCodeReporter } from './reporter'
import type { WorkerMeta } from './types'

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
        : undefined,
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
