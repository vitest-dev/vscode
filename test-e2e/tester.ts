import { basename } from 'node:path'
import type { Locator, Page } from '@playwright/test'

export class VSCodeTester {
  public tree: TesterTree
  public errors: TesterErrorOutput

  constructor(
    private page: Page,
  ) {
    this.tree = new TesterTree(page)
    this.errors = new TesterErrorOutput(page)
  }

  async openTestTab() {
    const tabLocator = this.page.getByRole('tab', { name: 'Testing' })
    const attribute = await tabLocator.getAttribute('aria-selected')
    if (attribute !== 'true')
      await tabLocator.locator('a').click()
  }

  async runAllTests() {
    await this.page.getByRole('button', { name: 'Run Tests' }).click()
  }
}

class TesterTree {
  constructor(
    private page: Page,
  ) {}

  getFileItem(file: string) {
    return new TesterTestItem(this.page.locator(`[title*="${basename(file)} "]`))
  }

  async expand(path: string) {
    const segments = path.split('/')
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const locator = this.page.locator(`[aria-label*="${segment} "][aria-level="${i + 1}"]`)
      const state = await locator.getAttribute('aria-expanded')
      if (state === 'true')
        continue
      await locator.click()
    }
  }
}

class TesterErrorOutput {
  constructor(
    private page: Page,
  ) {}

  getInlineErrors() {
    return this.page.locator('[class="test-message-inline-content"]')
  }

  async getInlineExpectedOutput() {
    return await this.page.locator(
      '[class="test-output-peek"] [class="editor original"] [class="view-lines"][role="presentation"]',
    ).textContent()
  }

  async getInlineActualOutput() {
    return await this.page.locator(
      '[class="test-output-peek"] [class="editor modified"] [class="view-lines"][role="presentation"]',
    ).textContent()
  }
}

export class TesterTestItem {
  constructor(
    public locator: Locator,
  ) {}

  async run() {
    await this.locator.getByLabel('Run Test').click()
  }

  async debug() {
    await this.locator.getByLabel('Debug Test').click()
  }

  async toggleContinuousRun() {
    await this.locator.getByLabel(/Turn (on|off) Continuous Run/).click()
  }

  async navigate() {
    await this.locator.getByLabel(/Go to Test/).click()
  }
}
