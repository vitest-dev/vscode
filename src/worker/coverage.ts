import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { CoverageProvider, ResolvedCoverageOptions, Vitest as VitestCore } from 'vitest'
import type { Vitest } from './vitest'

export class VitestCoverage {
  private _enabled = false
  private _provider: CoverageProvider | null | undefined = undefined

  private _coverageConfig: ResolvedCoverageOptions

  private _reporter: [string, any] = ['json', {}]
  private _reportsDirectory: string | null = null

  constructor(
    private ctx: VitestCore,
    private vitest: Vitest,
  ) {
    this._coverageConfig = ctx.config.coverage
    Object.defineProperty(ctx.config, 'coverage', {
      get: () => {
        return this.config
      },
      set: (coverage) => {
        this._coverageConfig = coverage
      },
    })
    Object.defineProperty(ctx, 'coverageProvider', {
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
      ...this._coverageConfig,
      enabled: this.enabled,
      reportOnFailure: true,
      reportsDirectory: this._reportsDirectory || this._coverageConfig.reportsDirectory,
      reporter: [this._reporter],
    }
  }

  public get enabled() {
    return this._enabled && !this.vitest.collecting
  }

  public async enable() {
    const vitest = this.ctx
    this._enabled = true

    const jsonReporter = this._coverageConfig.reporter.find(([name]) => name === 'json')
    this._reporter = jsonReporter || ['json', {}]
    this._reportsDirectory = join(tmpdir(), `vitest-coverage-${randomUUID()}`)

    if (!this._provider) {
      // @ts-expect-error private method
      await vitest.initCoverageProvider()
      await vitest.coverageProvider?.clean(this._coverageConfig.clean)
    }
    else {
      await this._provider.clean(this._coverageConfig.clean)
    }
  }

  public disable() {
    this._enabled = false
  }

  async waitForCoverageReport() {
    if (!this.enabled)
      return null
    const coverage = this.ctx.config.coverage
    if (!coverage.enabled || !this.ctx.coverageProvider)
      return null
    await this.ctx.runningPromise
    if (existsSync(coverage.reportsDirectory))
      return coverage.reportsDirectory
    return null
  }
}
