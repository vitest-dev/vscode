import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { CoverageProvider, ResolvedCoverageOptions, Vitest as VitestCore } from 'vitest'
import type { Vitest } from './vitest'

export class VitestCoverage {
  private _enabled = false
  private _provider: CoverageProvider | null | undefined = undefined

  private _config: ResolvedCoverageOptions

  constructor(
    private ctx: VitestCore,
    private vitest: Vitest,
  ) {
    this._config = ctx.config.coverage
    Object.defineProperty(ctx.config, 'coverage', {
      get: () => {
        return this.config
      },
      set: (coverage: ResolvedCoverageOptions) => {
        this._config = coverage
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
      ...this._config,
      enabled: this.enabled,
    }
  }

  public get enabled() {
    return this._enabled && !this.vitest.collecting
  }

  public async enable() {
    const vitest = this.ctx
    this._enabled = true

    const jsonReporter = this._config.reporter.find(([name]) => name === 'json')
    this._config.reporter = [jsonReporter || ['json', {}]]
    this._config.reportOnFailure = true
    this._config.reportsDirectory = join(tmpdir(), `vitest-coverage-${randomUUID()}`)

    if (!this._provider) {
      // @ts-expect-error private method
      await vitest.initCoverageProvider()
      await vitest.coverageProvider?.clean(this._config.clean)
    }
    else {
      await this._provider.clean(this._config.clean)
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
