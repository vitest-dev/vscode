import { beforeAll } from 'vitest'
import { createVscodeTest } from './helper'

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

const vscodeTest = createVscodeTest({
  extensionPath: '.',
  workspacePath: './samples/e2e',
  trace: true,
})

vscodeTest('basic', async ({ page }) => {
  // open test explorer
  await page.getByRole('tab', { name: 'Testing' }).locator('a').click()
  await page.getByText('No test results yet.').click()

  // run tests
  await page.getByRole('button', { name: 'Run Tests' }).click()

  // check results
  await page.locator(`[title*="pass.test.ts (Passed)"]`).click()
  await page.locator(`[title*="fail.test.ts (Failed)"]`).click()
  await page.locator(`[title*="mix.test.ts (Failed)"]`).click()
  await page.locator(`[title*="2/4 tests passed"]`).click()
})
