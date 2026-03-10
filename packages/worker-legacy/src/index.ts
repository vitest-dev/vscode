import type { SerializedProject, WorkerRunnerOptions, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { UserConfig } from 'vitest/node'
import { Console } from 'node:console'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { Writable } from 'node:stream'
import { toArray } from '@vitest/utils/helpers'
import { join } from 'pathe'
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
        ? meta.setupFilePaths.browserDebugLegacy
        : null,
    ].filter(v => v != null),
  })

  let stdout: Writable | undefined
  let stderr: Writable | undefined

  if (data.sendLog) {
    stdout = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        reporter.sendTerminalLog('stdout', log)
        callback()
      },
    })

    stderr = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        reporter.sendTerminalLog('stderr', log)
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
    project: meta.projectFilter ?? args.project,
    watch: true,
    api: false,
    // @ts-expect-error private property
    reporter: undefined,
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
  if (typeof data.debug === 'object') {
    const inspect = `${data.debug.host}:${data.debug.port}`
    if (data.debug.browser) {
      cliOptions.inspect = inspect
    }
    else {
      cliOptions.inspectBrk = inspect
    }
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
          config(userConfig) {
            const test = (userConfig.test ??= {})
            const testReporters = toArray(test.reporters)
            if (!testReporters.length) {
              testReporters.push(['default', { isTTY: false }])
            }
            testReporters.push(reporter as any)
            test.reporters = testReporters
            return {
              test: {
                coverage: {
                  enabled: !!data.coverage,
                  reportOnFailure: true,
                  reportsDirectory: join(tmpdir(), `vitest-coverage-${randomUUID()}`),
                  reporter: [
                    ['json', { file: meta.finalCoverageFileName }],
                  ],
                },
              },
            }
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

            const browser = context.project.config.browser
            if (browser?.enabled && typeof data.debug === 'object') {
              context.project.config.setupFiles.push(meta.setupFilePaths.browserDebugLegacy)
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

  const projects: SerializedProject[] = vitest.projects.map((project) => {
    const config = project.config
    return {
      config: project.server.config.configFile,
      root: config.root,
      dir: config.dir,
      include: config.include,
      exclude: config.exclude,
      includeSource: config.includeSource,
      pool: project.config.browser?.enabled ? 'browser' : config.pool,
      name: project.name,
      browser: project.config.browser?.enabled
        ? {
            provider: config.browser.provider || 'preview',
            name: config.browser.name,
            webRoot: config.root,
          }
        : undefined,
    }
  })

  const workspaceSource: string | false = meta.workspaceFile
    ? meta.workspaceFile
    : (vitest.config.workspace != null || vitest.config.projects != null)
        ? vitest.server.config.configFile || false
        : false
  return {
    vitest,
    reporter,
    workspaceSource,
    projects,
    meta,
    createWorker() {
      return new ExtensionWorker(
        vitest,
        !!data.debug,
        emitter,
      )
    },
  }
}
