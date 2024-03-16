import { beforeAll } from 'vitest'
import { test } from './helper'

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

test('basic', async ({ launch }) => {
  const { page } = await launch({
    workspacePath: './samples/e2e',
  })

  // open test explorer
  await page.getByRole('tab', { name: 'Testing' }).locator('a').click()
  await page.getByText('No test results yet.').click()

  // open nested folders
  await page.getByText(/^test$/).click()

  // run tests
  await page.getByRole('button', { name: 'Run Tests' }).click()

  // check results
  await page.locator(`[title*="pass.test.ts (Passed)"]`).click()
  await page.locator(`[title*="fail.test.ts (Failed)"]`).click()
  await page.locator(`[title*="mix.test.ts (Failed)"]`).click()
  await page.locator(`[title*="3/7 tests passed"]`).click()
})

test('imba', async ({ launch }) => {
  const { page } = await launch({
    workspacePath: './samples/imba',
  })

  // open test explorer
  await page.getByRole('tab', { name: 'Testing' }).locator('a').click()

  // open nested folders
  await page.getByText(/^test$/).click()
  await page.getByText(/^src$/).click()
  await page.getByText(/^components$/).click()

  // run tests
  await page.getByRole('button', { name: 'Run Tests' }).click()

  // check results
  await page.locator(`[title*="basic.test.imba (Passed)"]`).click()
  await page.locator(`[title*="utils.imba (Passed)"]`).click()
  await page.locator(`[title*="counter.imba (Failed)"]`).click()
})
