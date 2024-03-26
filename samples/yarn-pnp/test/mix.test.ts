import { expect, it } from 'vitest'

it('mix-pass', () => {
  expect(0).toBe(0)
})

it('mix-fail', () => {
  expect(0).toBe(1)
})
