import { describe, expect, it } from 'vitest'
import { add } from '../src/add'

describe('addition', () => {
  it('add', () => {
    expect(add(1, 1)).toBe(2)
  })
})
