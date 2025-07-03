import { expect } from '@playwright/test'
import type { TesterTestItem } from './tester'

type TestState = 'passed' | 'failed' | 'skipped' | 'waiting'
interface TestsTree {
  [test: string]: TestState | TestsTree
}

function getTitleFromState(state: TestState) {
  switch (state) {
    case 'passed':
      return '(Passed)'
    case 'failed':
      return '(Failed)'
    case 'skipped':
      return '(Skipped)'
    case 'waiting':
      return '(Not yet run)'
  }
}

expect.extend({
  async toHaveState(item: TesterTestItem, state: TestState) {
    const title = await item.locator.getAttribute('aria-label')
    const pass = !!(title && title.includes(getTitleFromState(state)))

    return {
      pass,
      message: () => `${this.utils.matcherHint('toHaveState', title, state, { isNot: this.isNot })}\n\n`
      + `Locator: ${item.locator}\n`
      + `Expected: ${this.isNot ? 'not ' : ''}to have state: ${this.utils.printExpected(state)}\n`
      + `Received: ${this.utils.printReceived(title)}\n`,
      name: 'toHaveState',
    }
  },
  async toHaveError(item: TesterTestItem, error: string) {
    const page = item.page
    const depth = Number(await item.locator.getAttribute('aria-level'))

    await expect(page.locator(`[aria-label*="${error}"][aria-level="${depth + 1}"]`)).toBeVisible()

    return {
      pass: true,
      message: () => '',
    }
  },
  async toHaveTests(item: TesterTestItem, tests: TestsTree) {
    const page = item.page
    const depth = Number(await item.locator.getAttribute('aria-level'))
    const currentIndex = Number(await item.locator.getAttribute('data-index'))

    async function assert(test: string, level: number, state: TestState, itemIndex: number) {
      const [name, index = itemIndex] = test.split('|')
      let locator = `[aria-label*="${name} ${getTitleFromState(state)}"][aria-level="${level}"]`
      if (index) {
        locator += `[data-index="${index}"]`
      }
      await expect(page.locator(locator)).toBeAttached()
    }

    const counter = { index: currentIndex }

    async function traverse(tests: TestsTree, level = depth + 1) {
      for (const test in tests) {
        counter.index++

        const item = tests[test]
        if (typeof item === 'string') {
          await assert(test, level, item, counter.index)
        }
        else {
          const [name, index = counter.index] = test.split('|')
          let locator = `[aria-label*="${name}"][aria-level="${level}"]`
          if (index) {
            locator += `[data-index="${index}"]`
          }
          await expect(page.locator(locator)).toBeAttached()

          await traverse(item, level + 1)
        }
      }
    }

    await traverse(tests)

    return {
      pass: true,
      message: () => '',
    }
  },
})

declare global {
  // eslint-disable-next-line ts/no-namespace
  export namespace PlaywrightTest {
    // eslint-disable-next-line unused-imports/no-unused-vars
    export interface Matchers<R, T = unknown> {
      toHaveState: (state: TestState) => Promise<R>
      /**
       * @example
       * expect(tester.tree.getFileItem('no-import.test.ts')).toHaveTests({
       *   multiply: 'waiting',
       *   divide: 'waiting',
       *   suite: {
       *     'some old test name': 'waiting',
       *   },
       * })
       */
      toHaveTests: (tests: TestsTree) => Promise<R>
      toHaveError: (error: string) => Promise<R>
    }
  }
}
