import { expect, it } from 'vitest'

it('uses the leaf config', { tags: ['leaf-only'] }, () => {
  expect(1 + 1).toBe(2)
})
