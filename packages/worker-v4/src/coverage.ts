import type { CoverageProvider, ResolvedCoverageOptions, Vitest } from 'vitest/node'
import { existsSync } from 'node:fs'

export class ExtensionCoverageManager {
  private _enabled = false
  private _provider: CoverageProvider | null | undefined = undefined

  private _config: ResolvedCoverageOptions

  constructor(private vitest: Vitest) {
    this._config = vitest.config.coverage
    const projects = new Set([
      ...vitest.projects,
      vitest.getRootProject(),
    ])
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

    Object.defineProperty(vitest, 'coverageProvider', {
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
    return this._enabled
  }

  public async enable() {
    const vitest = this.vitest
    this._enabled = true

    vitest.logger.log('Running coverage with configuration:', this.config)

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
    return (this.vitest as any).coverageProvider as CoverageProvider | null | undefined
  }

  public disable() {
    this._enabled = false
  }

  async waitForReport() {
    if (!this.enabled)
      return null
    const vitest = this.vitest
    const coverage = vitest.config.coverage
    if (!this._provider)
      return null
    vitest.logger.error(`Waiting for the coverage report to generate: ${coverage.reportsDirectory}`)
    await (vitest as any).runningPromise
    if (existsSync(coverage.reportsDirectory)) {
      vitest.logger.error(`Coverage reports retrieved: ${coverage.reportsDirectory}`)
      return coverage.reportsDirectory
    }
    vitest.logger.error(`Coverage reports directory not found: ${coverage.reportsDirectory}`)
    return null
  }
}
