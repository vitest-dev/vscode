import { expect } from 'chai'
import { transformTestPattern } from '../../src/pure/testName'

describe('testName', () => {
  describe('transformTestPattern', () => {
    [
      ['test', 'test'],
      ['$^+?()[]', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['$value', '.+?'],
      ['$obj_name.a', '.+?'],
      ['%%', '%'],
      ['%d = %f', '[\\d.eE+-]+? = [\\d.eE+-]+?'],
      ['%j = %o', '.+? = .+?'],
      ['test %i', 'test \\d+?'],
    ].forEach(([input, expected]) => {
      it(`isEach=true, value=${input}`, () => {
        expect(transformTestPattern({
          testName: input,
          isEach: true,
        })).to.equal(expected)
      })
    });

    [
      ['test', 'test'],
      ['$^+?()[]', '\\$\\^\\+\\?\\(\\)\\[\\]'],
      ['$value', '\\$value'],
      ['$obj_name.a', '\\$obj_name\\.a'],
      ['%%', '%%'],
      ['%d = %f', '%d = %f'],
      ['%j = %o', '%j = %o'],
      ['test %i', 'test %i'],
    ].forEach(([input, expected]) => {
      it(`isEach=false, value=${input}`, () => {
        expect(transformTestPattern({
          testName: input,
          isEach: false,
        })).to.equal(expected)
      })
    })
  })
})
