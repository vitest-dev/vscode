import { readFileSync, rmSync } from 'node:fs'
import { beforeAll, beforeEach, describe, onTestFailed } from 'vitest'
import { expect } from '@playwright/test'
import { test } from './utils/helper'
import { editFile } from './utils/tester'

// Vitst extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

beforeEach<{ logPath: string }>(({ logPath }) => {
  onTestFailed(() => {
    console.error(`Log during test:\n${readFileSync(logPath, 'utf-8')}`)
    if (!process.env.CI) {
      rmSync(logPath)
    }
  })
})

test('basic', async ({ launch }) => {
  const { page, tester } = await launch({
    workspacePath: './samples/e2e',
  })

  await expect(page.getByText('No test results yet.')).toBeVisible()

  await tester.tree.expand('test')
  await tester.tree.expand('test/pass.test.ts')

  const allPassTests = tester.tree.getFileItem('pass.test.ts')
  await expect(allPassTests).toHaveTests({
    'all-pass': 'waiting',
  })

  await tester.tree.expand('test/fail.test.ts')

  const allFailTests = tester.tree.getFileItem('fail.test.ts')
  await expect(allFailTests).toHaveTests({
    'all-fail': 'waiting',
  })

  await tester.tree.expand('test/mix.test.ts')

  const mixedTests = tester.tree.getFileItem('mix.test.ts')
  await expect(mixedTests).toHaveTests({
    'mix-pass': 'waiting',
    'mix-fail': 'waiting',
  })

  await tester.runAllTests()

  await expect(tester.tree.getResultsLocator()).toHaveText('2/4')
  await expect(allPassTests).toHaveState('passed')
  await expect(allPassTests).toHaveTests({
    'all-pass': 'passed',
  })
  await expect(allFailTests).toHaveState('failed')
  await expect(allFailTests).toHaveTests({
    'all-fail': 'failed',
  })
  await expect(mixedTests).toHaveState('failed')
  await expect(mixedTests).toHaveTests({
    'mix-pass': 'passed',
    'mix-fail': 'failed',
  })
})

test('workspaces', async ({ launch }) => {
  const { tester } = await launch({
    workspacePath: './samples/monorepo-vitest-workspace',
  })
  await tester.tree.expand('packages/react/test')

  const basicTest = tester.tree.getFileItem('basic.test.tsx [@vitest/test-react]')

  await expect(basicTest.locator).toBeVisible()
  await expect(tester.tree.getFileItem('basic.test.tsx [0]').locator).toBeVisible()

  await basicTest.run()

  // only runs tests in a single workspace project
  await expect(tester.tree.getResultsLocator()).toHaveText('1/1')

  await tester.runAllTests()

  await expect(tester.tree.getResultsLocator()).toHaveText('4/4')
})

test('custom imba language', async ({ launch }) => {
  const { tester } = await launch({
    workspacePath: './samples/imba',
  })

  await tester.tree.expand('test')
  await tester.tree.expand('src/components')

  await tester.runAllTests()

  await expect(tester.tree.getResultsLocator()).toHaveText('3/4')
  await expect(tester.tree.getFileItem('basic.test.imba')).toHaveState('passed')
  await expect(tester.tree.getFileItem('utils.imba')).toHaveState('passed')
  await expect(tester.tree.getFileItem('counter.imba')).toHaveState('failed')
})

test('browser mode correctly collects tests', async ({ launch }) => {
  const { tester } = await launch({
    workspacePath: './samples/browser',
  })

  await tester.tree.expand('test/console.test.ts [chromium]')
  const consoleTest = tester.tree.getFileItem('console.test.ts', 'chromium')

  await expect(consoleTest).toHaveTests({
    console: 'waiting',
  })

  editFile('samples/browser/test/console.test.ts', content => `/arakara---\n${content}`)

  await expect(consoleTest).toHaveError('Error: Unterminated regular expression')
})

test('watcher updates the file if there are several config files', async ({ launch }) => {
  const { tester } = await launch({
    workspacePath: './samples/multiple-configs',
  })

  await tester.tree.expand('app1/test-app1.test.ts')
  const app1Test = tester.tree.getFileItem('test-app1.test.ts')

  await expect(app1Test).toHaveTests({
    math: 'waiting',
  })

  await tester.tree.expand('app2/test-app2.test.ts')
  const app2Test = tester.tree.getFileItem('test-app2.test.ts')

  await expect(app2Test).toHaveTests({
    math: 'waiting',
  })

  editFile('samples/multiple-configs/app1/test-app1.test.ts', content => content.replace('math', 'math-123'))
  editFile('samples/multiple-configs/app2/test-app2.test.ts', content => content.replace('math', 'math-987'))

  await expect(app1Test).toHaveTests({
    'math-123': 'waiting',
  })
  await expect(app2Test).toHaveTests({
    'math-987': 'waiting',
  })
})

test('ast collector keeps the pattern on rerun', async ({ launch }) => {
  const sample = 'samples/ast-collector'

  const { tester } = await launch({
    workspacePath: sample,
  })

  await tester.tree.expand('test/each.test.ts/testing')
  // dynamic tests have a "pattern" label
  await tester.tree.expand('test/each.test.ts/pattern')

  const item = tester.tree.getFileItem('each.test.ts')

  await expect(item).toHaveTests({
    'testing': {
      // all pass: %i => %i
      'pattern|3': 'waiting',
      // table1: returns $expected when $a is added $b
      'pattern|4': 'waiting',
    },
    // testing %s
    'pattern|5': {
      'hello world': 'waiting',
      // testing %s and %s
      'pattern|7': 'waiting',
    },
  })

  await tester.runAllTests()

  await tester.tree.expand('test/each.test.ts/testing 1')
  await tester.tree.expand('test/each.test.ts/testing 2')

  await expect(item).toHaveTests({
    'testing|2': {
      // all pass: %i => %i
      'pattern|3': 'waiting',
      'all pass: 1 => 1': 'passed',
      'all pass: 2 => 2': 'passed',
      // table1: returns $expected when $a is added $b
      'pattern|6': 'waiting',
      'table1: returns 2 when 1 is added 1': 'passed',
      'table1: returns \'ab\' when \'a\' is added \'b\'': 'passed',
    },
    // testing %s
    'pattern|9': 'waiting',
    'testing 1': {
      'hello world|11': 'passed',
      'pattern|12': 'waiting',
      'testing test 3|13': 'passed',
      'testing test 4|14': 'passed',
    },
    'testing 2': {
      'hello world|16': 'passed',
      'pattern|17': 'waiting',
      'testing test 3|18': 'passed',
      'testing test 4|19': 'passed',
    },
  })
})

describe('continuous testing', () => {
  test('reruns tests on test file change', async ({ launch }) => {
    const { tester } = await launch({
      workspacePath: './samples/continuous',
    })

    await tester.tree.expand('test/imports-divide.test.ts')
    const item = tester.tree.getFileItem('imports-divide.test.ts')

    await expect(item).toHaveTests({
      divide: 'waiting',
    })

    await item.toggleContinuousRun()

    editFile('samples/continuous/test/imports-divide.test.ts', content => `${content}\n`)

    await expect(item).toHaveTests({
      divide: 'passed',
    })

    editFile('samples/continuous/src/calculator.ts', content => content.replace('a / b', '1000'))

    await expect(item).toHaveTests({
      divide: 'failed',
    })
    await item.navigate()

    const errors = await tester.errors.getInlineErrors()

    expect(errors).toEqual([
      '1000 != 2',
    ])
  })
})
