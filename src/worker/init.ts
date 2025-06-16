import type { UserConfig, WorkspaceProject } from 'vitest/node'
import type { WorkerInitMetadata } from './types'
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { VSCodeReporter } from './reporter'
import { normalizeDriveLetter } from './utils'

export async function initVitest(meta: WorkerInitMetadata, options?: UserConfig) {
  const reporter = new VSCodeReporter()

  let stdout: Writable | undefined
  let stderr: Writable | undefined

  if (meta.shellType === 'terminal') {
    stdout = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        if (reporter.rpc) {
          reporter.rpc.onProcessLog('stdout', log).catch(() => {})
        }
        process.stdout.write(log)
        callback()
      },
    })

    stderr = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        if (reporter.rpc) {
          reporter.rpc.onProcessLog('stderr', log).catch(() => {})
        }
        process.stderr.write(log)
        callback()
      },
    })
    globalThis.console = new Console(stdout, stderr)
  }

  const vitestModule = await import(
    pathToFileURL(normalizeDriveLetter(meta.vitestNodePath)).toString()
  ) as typeof import('vitest/node')
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
  const cliOptions: UserConfig = {
    config: meta.configFile,
    ...(meta.workspaceFile ? { workspace: meta.workspaceFile } : {}),
    ...args,
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
      : {},
  }
  const vitest = await vitestModule.createVitest(
    'test',
    cliOptions,
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
    {
      stderr,
      stdout,
    },
  )
  await (vitest as any).report('onInit', vitest)
  const configs = ([
    // @ts-expect-error -- getRootProject in Vitest 3.0
    'getRootProject' in vitest ? vitest.getRootProject() : vitest.getCoreWorkspaceProject(),
    ...vitest.projects,
  ] as WorkspaceProject[]).map(p => p.server.config.configFile).filter(c => c != null)
  const workspaceSource: string | false = meta.workspaceFile
    ? meta.workspaceFile
    : (vitest.config.workspace != null || vitest.config.projects != null)
        ? vitest.server.config.configFile || false
        : false
  return {
    vitest,
    reporter,
    workspaceSource,
    configs: Array.from(new Set(configs)),
    meta,
  }
}
