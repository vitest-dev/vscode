import { describe, expect, it } from 'vitest'
import { transformTestPattern } from '../../src/pure/testName'

describe('testName', () => {
  describe('transformTestPattern', () => {
    it.each([
      ['test', 'test'],
      ['$^+?()[]', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['$value', '.+?'],
      ['$obj_name.a', '.+?'],
      ['test %i', 'test \\d+?'],
    ])('isEach=true, %s', (input, expected) => {
      expect(transformTestPattern({
        testName: input,
        isEach: true,
      })).toBe(expected)
    })
    it.each([
      ['test', 'test'],
      ['$^+?()[]', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['$value', '\\$value'],
      ['$obj_name.a', '\\$obj_name.a'],
      ['test %i', 'test %i'],
    ])('isEach=false %s', (input, expected) => {
      expect(transformTestPattern({
        testName: input,
        isEach: false,
      })).toBe(expected)
    })
  })
})
