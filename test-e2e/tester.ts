import { basename } from 'node:path'
import fs from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { afterEach } from 'vitest'

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
    await this.page
      .getByRole('toolbar', { name: 'Testing actions', exact: true })
      .getByRole('button', { name: /^Run Tests$/ })
      .first()
      .click()
  }
}

class TesterTree {
  constructor(
    private page: Page,
  ) {}

  getResultsLocator() {
    return this.page.locator(`.result-summary > [custom-hover]`)
  }

  getFileItem(file: string) {
    const name = basename(file)
    return new TesterTestItem(name, this.page.locator(`[aria-label*="${name} ("]`), this.page)
  }

  async expand(path: string) {
    const segments = path.split('/')
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const locator = this.page
        // not yet run
        .locator(`[aria-label*="${segment} ("][aria-level="${i + 1}"]`)
        // test already run
        .or(this.page.locator(`[aria-label="${segment}"][aria-level="${i + 1}"]`))
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

  async getInlineErrors() {
    const locator = this.page.locator('.test-error-content-widget')
    const text = await locator.allInnerTexts()
    return text.map(t => t.trim().replace(/\s/g, ' '))
  }

  async getInlineExpectedOutput() {
    return await this.page.locator(
      '.test-output-peek .editor.original .view-lines[role="presentation"]',
    ).textContent()
  }

  async getInlineActualOutput() {
    return await this.page.locator(
      '.test-output-peek .editor.modified .view-lines[role="presentation"]',
    ).textContent()
  }
}

export class TesterTestItem {
  constructor(
    public name: string,
    public locator: Locator,
    public page: Page,
  ) {}

  async run() {
    await this.locator.hover()
    await this.locator.getByLabel('Run Test', { exact: true }).click()
  }

  async debug() {
    await this.locator.hover()
    await this.locator.getByLabel('Debug Test', { exact: true }).click()
  }

  async coverage() {
    await this.locator.hover()
    await this.locator.getByLabel('Run Test with Coverage', { exact: true }).click()
  }

  async toggleContinuousRun() {
    await this.locator.hover()
    await this.locator.getByLabel(/Turn (on|off) Continuous Run/).click()
  }

  async navigate() {
    await this.locator.click({ force: true })
    await this.locator.press('Alt+Enter')
    // await this.locator.getByLabel(/Go to Test/).click()
    // wait until the page is navigated
    await this.page.getByRole('tab', { name: new RegExp(this.name) }).waitFor()
  }
}

const originalFiles = new Map<string, string>()
const createdFiles = new Set<string>()
afterEach(() => {
  originalFiles.forEach((content, file) => {
    fs.writeFileSync(file, content, 'utf-8')
  })
  createdFiles.forEach((file) => {
    if (fs.existsSync(file))
      fs.unlinkSync(file)
  })
  originalFiles.clear()
  createdFiles.clear()
})

export function editFile(file: string, callback: (content: string) => string) {
  const content = fs.readFileSync(file, 'utf-8')
  if (!originalFiles.has(file))
    originalFiles.set(file, content)
  fs.writeFileSync(file, callback(content), 'utf-8')
}
