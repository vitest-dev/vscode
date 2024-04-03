import { beforeAll, describe } from 'vitest'
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

  await tester.tree.expand('test')

  await tester.runAllTests()

  await expect(page).toHaveResults('3/7')
  await expect(tester.tree.getFileItem('pass.test.ts')).toHaveState('passed')
  await expect(tester.tree.getFileItem('fail.test.ts')).toHaveState('failed')
  await expect(tester.tree.getFileItem('mix.test.ts')).toHaveState('failed')
})

test('custom imba language', async ({ launch }) => {
  const { page, tester } = await launch({
    workspacePath: './samples/imba',
  })

  await tester.openTestTab()

  await tester.tree.expand('test')
  await tester.tree.expand('src/components')

  await tester.runAllTests()

  await expect(page).toHaveResults('5/7')
  await expect(tester.tree.getFileItem('basic.test.imba')).toHaveState('passed')
  await expect(tester.tree.getFileItem('utils.imba')).toHaveState('passed')
  await expect(tester.tree.getFileItem('counter.imba')).toHaveState('failed')
})

describe('continuous testing', () => {

})
