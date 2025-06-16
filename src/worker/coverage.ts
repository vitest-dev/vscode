import type { CoverageProvider, ResolvedCoverageOptions } from 'vitest/node'
import type { ExtensionWorker } from './worker'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { finalCoverageFileName } from '../constants'

export class ExtensionCoverageManager {
  private _enabled = false
  private _provider: CoverageProvider | null | undefined = undefined

  private _config: ResolvedCoverageOptions

  constructor(
    private worker: ExtensionWorker,
  ) {
    this._config = worker.ctx.config.coverage
    const projects = new Set([...worker.ctx.projects, worker.getRootTestProject()])
    projects.forEach((project) => {
      Object.defineProperty(project.config, 'coverage', {
        get: () => {
          return this.config
        },
        set: (coverage: ResolvedCoverageOptions) => {
          this._config = coverage
        },
      })
    })
    Object.defineProperty(worker.ctx, 'coverageProvider', {
      get: () => {
        if (this.enabled)
          return this._provider

        return null
      },
      set: (provider: CoverageProvider | null) => {
        this._provider = provider
      },
    })
  }

  public get config(): ResolvedCoverageOptions {
    return {
      ...this._config,
      enabled: this.enabled,
    }
  }

  public get enabled() {
    return this._enabled && !this.worker.collecting
  }

  public get resolved() {
    return !!this._provider
  }

  public async enable() {
    const vitest = this.worker.ctx
    this._enabled = true

    const jsonReporter = this._config.reporter.find(([name]) => name === 'json')
    this._config.reporter = [
      ['json', {
        ...jsonReporter?.[1],
        file: finalCoverageFileName,
      }],
    ]
    this._config.reportOnFailure = true
    this._config.reportsDirectory = join(tmpdir(), `vitest-coverage-${randomUUID()}`)

    this.worker.ctx.logger.log('Running coverage with configuration:', this.config)

    if (!this._provider) {
      // @ts-expect-error private method
      await vitest.initCoverageProvider()
      await this.coverageProvider?.clean(this._config.clean)
    }
    else {
      await this._provider.clean(this._config.clean)
    }
  }

  private get coverageProvider() {
    return (this.worker.ctx as any).coverageProvider as CoverageProvider | null | undefined
  }

  public disable() {
    this._enabled = false
  }

  async waitForReport() {
    if (!this.enabled)
      return null
    const ctx = this.worker.ctx
    const coverage = ctx.config.coverage
    if (!coverage.enabled || !this.coverageProvider)
      return null
    ctx.logger.error(`Waiting for the coverage report to generate: ${coverage.reportsDirectory}`)
    await (ctx as any).runningPromise
    if (existsSync(coverage.reportsDirectory)) {
      ctx.logger.error(`Coverage reports retrieved: ${coverage.reportsDirectory}`)
      return coverage.reportsDirectory
    }
    ctx.logger.error(`Coverage reports directory not found: ${coverage.reportsDirectory}`)
    return null
  }
}
