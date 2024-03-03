import { vscodeTest } from '@hiogawa/vscode-e2e/vitest'
import { beforeEach } from 'vitest'

beforeEach(({ task }) => {
  task.meta.vscodeExtensionPath = '.'
  task.meta.vscodeWorkspacePath = './samples/basic'
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
  await page.locator(`[title*="test/add.test.ts (Failed)"]`).click()
  await page.locator(`[title*="test/mul.test.ts (Passed)"]`).click()
  await page.locator(`[title*="28/43 tests passed"]`).click()
})
