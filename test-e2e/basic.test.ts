import { beforeAll } from 'vitest'
import { vscodeTest } from './helper'

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

vscodeTest('basic', async ({ launch }) => {
  const { page } = await launch({
    workspacePath: './samples/e2e',
  })

  // open test explorer
  await page.getByRole('tab', { name: 'Testing' }).locator('a').click()
  await page.getByText('No test results yet.').click()

  // run tests
  await page.getByRole('button', { name: 'Run Tests' }).click()

  // open nested folders
  await page.getByText(/^test$/).click()

  // check results
  await page.locator(`[title*="pass.test.ts (Passed)"]`).click()
  await page.locator(`[title*="fail.test.ts (Failed)"]`).click()
  await page.locator(`[title*="mix.test.ts (Failed)"]`).click()
  await page.locator(`[title*="3/7 tests passed"]`).click()
})
