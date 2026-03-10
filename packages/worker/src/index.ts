import type { SerializedProject, WorkerRunnerOptions, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { TestUserConfig } from 'vitest/node'
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import { toArray } from '@vitest/utils/helpers'
import { VSCodeReporter } from './reporter'
import { ExtensionWorker } from './worker'

export async function initVitest(
  vitestModule: typeof import('vitest/node'),
  data: WorkerRunnerOptions,
  emitter: WorkerWSEventEmitter,
) {
  const meta = data.meta
  const reporter = new VSCodeReporter(meta, data.debug)

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
  const cliOptions: TestUserConfig = {
    config: meta.configFile,
    ...args,
    ...options,
    project: meta.projectFilter ?? args.project,
    watch: true,
    api: false,
    // @ts-expect-error private property
    reporter: undefined,
    ui: false,
    includeTaskLocation: true,
    experimental: {
      importDurations: {
        limit: Infinity,
        failOnDanger: false,
        print: false,
      },
    },
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
        watch: null,
      },
      plugins: [
        {
          name: 'vitest:vscode-extension',
          config(userConfig) {
            userConfig.test ??= {}

            const testReporters = toArray(userConfig.test.reporters)
            if (!testReporters.length) {
              testReporters.push(['default', { isTTY: false }])
            }
            testReporters.push(reporter as any)
            userConfig.test.reporters = testReporters

            return {
              test: {
                printConsoleTrace: true,
                coverage: {
                  enabled: !!data.coverage,
                  reportOnFailure: true,
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
          api: {
            vitest: {
              experimental: {
                ignoreFsModuleCache: true,
              },
            },
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
      config: project.vite.config.configFile,
      root: config.root,
      dir: config.dir,
      include: config.include,
      exclude: config.exclude,
      includeSource: config.includeSource,
      pool: project.isBrowserEnabled() ? 'browser' : config.pool,
      name: project.name,
      browser: project.isBrowserEnabled()
        ? {
            provider: config.browser.provider?.name || 'preview',
            name: config.browser.name,
            webRoot: config.root,
          }
        : undefined,
    }
  })

  const workspaceSource: string | false = (vitest.config.projects != null)
    ? vitest.vite.config.configFile || false
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
