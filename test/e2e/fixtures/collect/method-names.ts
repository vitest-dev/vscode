import { describe, expect, it } from 'vitest'
import { MathClass } from './math-class'

describe(MathClass, () => {
  describe(MathClass.add, () => {
    it('adds 2 + 2', () => {
      const expected = 4
      const actual = MathClass.add(2, 2)
      expect(actual).toBe(expected)
    })
  })
})
