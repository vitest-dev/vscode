import { expect, it } from 'vitest'

it('runs with the leaf tag', { tags: ['leaf'] }, () => {
  expect(true).toBe(true)
})
