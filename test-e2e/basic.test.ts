import { beforeAll } from 'vitest'
import { test } from './helper'
import { execa } from "execa"
import { expect } from "@playwright/test"

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

test('basic', async ({ launch }) => {
  await execa("pnpm", ["i"], { cwd: "./samples/e2e" });
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
  await expect(page.locator(`[title*="pass.test.ts (Passed)"]`)).toBeVisible()
  await expect(page.locator(`[title*="fail.test.ts (Failed)"]`)).toBeVisible()
  await expect(page.locator(`[title*="mix.test.ts (Failed)"]`)).toBeVisible()
  await expect(page.locator(`[title*="3/7 tests passed"]`)).toBeVisible()
})

test('imba', async ({ launch }) => {
  await execa("npm", ["i"], { cwd: "./samples/imba" });
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
  await expect(page.locator(`[title*="5/7 tests passed"]`)).toBeVisible()
  await expect(page.locator(`[title*="basic.test.imba (Passed)"]`)).toBeVisible()
  await expect(page.locator(`[title*="utils.imba (Passed)"]`)).toBeVisible()
  await expect(page.locator(`[title*="counter.imba (Failed)"]`)).toBeVisible()
})
