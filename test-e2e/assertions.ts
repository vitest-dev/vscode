import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { TesterTestItem } from './tester'

type TestState = 'passed' | 'failed' | 'skipped'

function getTitleFromState(state: TestState) {
  switch (state) {
    case 'passed':
      return '(Passed)'
    case 'failed':
      return '(Failed)'
    case 'skipped':
      return '(Skipped)'
  }
}

expect.extend({
  async toHaveResults(page: Page, number: string) {
    const title = await page.locator(`[title*="tests passed ("]`).getAttribute('title')
    const expected = `${number} tests passed`
    const pass = !!(title && title.includes(expected))

    return {
      message: () => `${this.utils.matcherHint('toHaveResults', title, expected, { isNot: this.isNot })}\n\n`
      + `Expected: ${this.isNot ? 'not ' : ''}to have results: ${this.utils.printExpected(number)}\n`
      + `Received: ${this.utils.printReceived(title)}\n`,
      pass,
      name: 'toHaveResults',
      expected,
      actual: title,
    }
  },
  async toHaveState(item: TesterTestItem, state: TestState) {
    const title = await item.locator.getAttribute('title')
    const pass = !!(title && title.includes(getTitleFromState(state)))

    return {
      pass,
      message: () => `${this.utils.matcherHint('toHaveState', title, getTitleFromState(state), { isNot: this.isNot })}\n\n`
      + `Locator: ${item.locator}\n`
      + `Expected: ${this.isNot ? 'not ' : ''}to have state: ${this.utils.printExpected(state)}\n`
      + `Received: ${this.utils.printReceived(title)}\n`,
      name: 'toHaveState',
    }
  },
})

declare global {
  // eslint-disable-next-line ts/no-namespace
  export namespace PlaywrightTest {
    // eslint-disable-next-line unused-imports/no-unused-vars
    export interface Matchers<R, T = unknown> {
      toHaveState: (state: TestState) => Promise<R>
      toHaveResults: (state: string) => Promise<R>
    }
  }
}
