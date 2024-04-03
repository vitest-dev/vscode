import { basename } from 'node:path'
import type { Page } from '@playwright/test'

export class VSCodeTester {
  constructor(
    private page: Page,
  ) {}

  async openTestTab() {
    const tabLocator = this.page.getByRole('tab', { name: 'Testing' })
    const handler = await tabLocator.elementHandle()
    if (!handler)
      throw new Error(`Cannot find locator: ${tabLocator}`)
    if (await handler.getAttribute('aria-selected') !== 'true')
      await tabLocator.locator('a').click()
  }

  async runAllTests() {
    await this.page.getByRole('button', { name: 'Run Tests' }).click()
  }

  getByFileName(file: string) {
    return this.page.locator(`[title*="${basename(file)} "]`)
  }

  async expandTree(path: string) {
    const segments = path.split('/')
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const locator = this.page.locator(`[aria-label*="${segment} "][aria-level="${i + 1}"]`)
      const handler = await locator.elementHandle()
      if (!handler)
        throw new Error(`Cannot find locator: ${locator}`)
      const state = await handler.getAttribute('aria-expanded')
      if (state === 'true')
        continue
      await locator.click()
    }
  }
}
