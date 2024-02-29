import { expect, it } from 'vitest'

it.each([1, 2, 3])(`test %i`, (i) => {
  expect(i).toBe(i)
})
