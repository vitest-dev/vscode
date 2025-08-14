import type { Vitest } from 'vitest/node'
import { existsSync } from 'node:fs'

export class ExtensionCoverageManager {
  private _enabled = false

  constructor(private vitest: Vitest) {}

  async enableCoverage() {
    await this.vitest.enableCoverage()
    this._enabled = true
  }

  disableCoverage() {
    this._enabled = false
    this.vitest.disableCoverage()
  }

  async waitForReport() {
    if (!this._enabled)
      return null
    const vitest = this.vitest
    const coverage = vitest.config.coverage
    // TODO: use verbose logger instead
    vitest.logger.error(`Waiting for the coverage report to generate: ${coverage.reportsDirectory}`)
    await vitest.waitForTestRunEnd()
    if (existsSync(coverage.reportsDirectory)) {
      vitest.logger.error(`Coverage reports retrieved: ${coverage.reportsDirectory}`)
      return coverage.reportsDirectory
    }
    vitest.logger.error(`Coverage reports directory not found: ${coverage.reportsDirectory}`)
    return null
  }
}
