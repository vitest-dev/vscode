import { expectTypeOf, test } from 'vitest'

test('ts', () => {
  expectTypeOf(1).toBeBoolean()
})
