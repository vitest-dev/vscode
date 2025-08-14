import type { WorkerRunnerOptions } from 'vitest-vscode-shared'
import type { WorkerWSEventEmitter } from 'vitest-vscode-shared'
import type { CoverageIstanbulOptions, TestUserConfig } from 'vitest/node'
import { Console } from 'node:console'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    setupFilePath: meta.setupFilePath,
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
  const cliOptions: TestUserConfig = {
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
        watch: null,
      },
      plugins: [
        {
          name: 'vitest:vscode-extension',
          config(userConfig) {
            const testConfig = userConfig.test ?? {}
            const coverageOptions = (testConfig.coverage ?? {}) as CoverageIstanbulOptions
            const reporters = Array.isArray(coverageOptions.reporter)
              ? coverageOptions.reporter
              : [coverageOptions.reporter]
            const jsonReporter = reporters.find(r => r && r[0] === 'json')
            const jsonReporterOptions = typeof jsonReporter?.[1] === 'object' ? jsonReporter[1] : {}
            coverageOptions.reporter = [
              ['json', { ...jsonReporterOptions, file: meta.finalCoverageFileName }],
            ]
            return {
              test: {
                coverage: {
                  reportOnFailure: true,
                  reportsDirectory: join(tmpdir(), `vitest-coverage-${randomUUID()}`),
                },
              },
              // TODO: type is not augmented
            } as any
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
  const configs = [
    vitest.getRootProject(),
    ...vitest.projects,
  ].map(p => p.vite.config.configFile).filter(c => c != null)
  const workspaceSource: string | false = (vitest.config.projects != null)
    ? vitest.vite.config.configFile || false
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
        data.debug,
        data.astCollect,
        emitter,
      )
    },
  }
}
