import { test } from 'vitest'
import { multiply } from '../src/calculator'
import { expect } from 'vitest'

test('multiply', () => {
  expect(multiply(2, 3)).toBe(6)
})
