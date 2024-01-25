import { describe, expect, it } from 'vitest'
import parse from '../../src/pure/parsers'
import { transformTestPattern } from '../../src/pure/testName'

describe('testName', () => {
  describe('transformTestPattern', () => {
    it.each([
      ['describe(\'test\', () => {})', 'test'],
      ['describe(\'$^+?()[]\', () => {})', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['describe.each([1,2,3])(`test %i`, (i) => {})', 'test \\d+?'],
    ])('describe %s', (input, expected) => {
      const [block] = parse('x.js', input).describeBlocks
      expect(transformTestPattern(block)).toBe(expected)
    })
    it.each([
      ['test(\'add\', () => {})', 'add'],
      ['test(\'$^+?()[]\', () => {})', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['test.each([1,2,3])(`test %i`, (i) => {})', 'test \\d+?'],
    ])('test %s', (input, expected) => {
      const [block] = parse('x.js', input).itBlocks
      expect(transformTestPattern(block)).toBe(expected)
    })
  })
})
