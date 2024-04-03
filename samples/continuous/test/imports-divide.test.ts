import { test } from 'vitest'
import { divide } from '../src/calculator'
import { expect } from 'vitest'

test('divide', () => {
  expect(divide(6, 3)).toBe(2)
})

