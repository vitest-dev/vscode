import { beforeAll } from 'vitest'
import { expect } from '@playwright/test'
import { test } from './helper'

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

test('basic', async ({ launch }) => {
  const { page, tester } = await launch({
    workspacePath: './samples/e2e',
  })

  await tester.openTestTab()
  await expect(page.getByText('No test results yet.')).toBeVisible()

  await tester.uncollapse('test')

  await tester.runAllTests()

  await expect(page).toHaveResults('3/7')
  await expect(tester.getByFileName('pass.test.ts')).toHaveState('passed')
  await expect(tester.getByFileName('fail.test.ts')).toHaveState('failed')
  await expect(tester.getByFileName('mix.test.ts')).toHaveState('failed')
})

test('custom imba language', async ({ launch }) => {
  const { page, tester } = await launch({
    workspacePath: './samples/imba',
  })

  await tester.openTestTab()

  await tester.uncollapse('test')
  await tester.uncollapse('src/components')

  await tester.runAllTests()

  await expect(page).toHaveResults('5/7')
  await expect(tester.getByFileName('basic.test.imba')).toHaveState('passed')
  await expect(tester.getByFileName('utils.imba')).toHaveState('passed')
  await expect(tester.getByFileName('counter.imba')).toHaveState('failed')
})
