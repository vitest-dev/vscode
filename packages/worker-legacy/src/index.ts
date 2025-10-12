import type { WorkerRunnerOptions, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { UserConfig, WorkspaceProject } from 'vitest/node'
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import { VSCodeReporter } from './reporter'
import { ExtensionWorker } from './worker'

export async function initVitest(
  vitestModule: typeof import('vitest/node'),
  data: WorkerRunnerOptions,
  emitter: WorkerWSEventEmitter,
) {
  const meta = data.meta
  const reporter = new VSCodeReporter({
    setupFilePaths: [
      typeof data.debug === 'object' && data.debug.browser
        ? meta.setupFilePaths.browserDebug
        : null,
      meta.setupFilePaths.watcher,
    ].filter(v => v != null),
  })

  let stdout: Writable | undefined
  let stderr: Writable | undefined

  if (meta.shellType === 'terminal' && !meta.hasShellIntegration) {
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
  const options = data.debug
    ? {
        disableConsoleIntercept: true,
        fileParallelism: false,
        testTimeout: 0,
        hookTimeout: 0,
      }
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
          configureVitest(context) {
            // Enable printConsoleTrace for inline console log display
            context.project.config.printConsoleTrace = true

            const options = context.project.config.browser
            if (options?.enabled && typeof data.debug === 'object') {
              context.project.config.setupFiles.push(meta.setupFilePaths.browserDebug)
              context.vitest.config.inspector = {
                enabled: true,
                port: data.debug.port,
                host: data.debug.host,
                waitForDebugger: false,
              }
              context.project.config.inspector = context.vitest.config.inspector
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
    createWorker() {
      return new ExtensionWorker(
        vitest,
        !!data.debug,
        data.astCollect,
        emitter,
        data.meta.finalCoverageFileName,
      )
    },
  }
}
