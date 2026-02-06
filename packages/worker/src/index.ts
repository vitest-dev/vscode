import type { SerializedProject, WorkerRunnerOptions, WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { CoverageIstanbulOptions, TestUserConfig } from 'vitest/node'
import { Console } from 'node:console'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  if (data.debug) {
    stdout = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        reporter.sendTerminalLog('stdout', log)
        // process.stdout.write(log)
        callback()
      },
    })

    stderr = new Writable({
      write(chunk, __, callback) {
        const log = chunk.toString()
        reporter.sendTerminalLog('stderr', log)
        // process.stderr.write(log)
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
    watch: true,
    api: false,
    // @ts-expect-error private property
    reporter: undefined,
    ui: false,
    includeTaskLocation: true,
    inspect: typeof data.debug === 'object'
      ? `${data.debug.host}:${data.debug.port}`
      : undefined,
    experimental: {
      importDurations: {
        limit: Infinity,
        failOnDanger: false,
        print: false,
      },
    },
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

            const testConfig = userConfig.test
            const coverageOptions = (testConfig.coverage ??= {}) as CoverageIstanbulOptions
            const coverageReporters = coverageOptions.reporter && Array.isArray(coverageOptions.reporter)
              ? coverageOptions.reporter
              : [coverageOptions.reporter]
            const jsonReporter = coverageReporters.find(r => r && r[0] === 'json')
            const jsonReporterOptions = typeof jsonReporter?.[1] === 'object' ? jsonReporter[1] : {}
            coverageOptions.reporter = [
              ['json', { ...jsonReporterOptions, file: meta.finalCoverageFileName }],
            ]

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
                  reportOnFailure: true,
                  reportsDirectory: join(tmpdir(), `vitest-coverage-${randomUUID()}`),
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
  await (vitest as any).report('onInit', vitest)

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
