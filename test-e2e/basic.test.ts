import { vscodeTest } from '@hiogawa/vscode-e2e/vitest'
import { beforeEach } from 'vitest'

beforeEach(({ task }) => {
  task.meta.vscodeExtensionPath = '.'
  task.meta.vscodeWorkspacePath = './samples/e2e'
  task.meta.vscodeTrace = 'on'

  // Vitst extension doesn't work with CI flag
  delete process.env.CI
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
