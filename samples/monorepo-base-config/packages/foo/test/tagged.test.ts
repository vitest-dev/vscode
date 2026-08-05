import { expect, it } from 'vitest'

it('runs with the integration tag', { tags: ['integration'] }, () => {
  expect(1).toBe(1)
})

it('runs without a tag', () => {
  expect(2).toBe(2)
})
