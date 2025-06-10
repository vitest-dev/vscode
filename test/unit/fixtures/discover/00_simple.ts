import { describe, it, expect } from 'vitest'

describe('describe', () => {
  it('test', () => {
    expect(1).toBe(1)
  })
  it.each([1, 2, 3])("test %i", (a) => {
    expect(a).toBe(a);
  })
})
