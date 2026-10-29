import { describe, expect, it } from 'vitest'

describe('Outer', () => {
  describe('Inner', () => {
    it('does a thing', () => {
      expect('1').toMatchSnapshot()
      expect('2').toMatchInlineSnapshot('2')
      expect('3').toMatchSnapshot()
      expect({ a: 1 }).toMatchSnapshot('second')
      expect('4').toThrowErrorMatchingSnapshot()
    })
  })

  it('top level it', () => {
    expect({ a: 1 }).toMatchSnapshot({ a: expect.any(Number) })
  })
})

it('no describe', () => {
  expect('x').toMatchSnapshot()
})

it.only('modified block', () => {
  expect('x').toMatchSnapshot()
})

it('handles `code` in title', () => {
  expect('0').toMatchSnapshot()
})

it.each([1, 2])('dynamic %s', () => {
  expect('x').toMatchSnapshot()
})
