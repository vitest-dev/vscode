import { describe, expect, it, test, } from 'vitest'

describe('testing', (a) => {
  it.each([
    [1, 1], [2, 2]
  ])(`all pass: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  test.each`
    a               | b      | expected
    ${1}            | ${1}   | ${2}
    ${'a'}          | ${'b'} | ${'ab'}
  `('table1: returns $expected when $a is added $b', ({ a, b, expected }) => {
    expect(a + b).toBe(expected)
  })
})

describe.each([1, 2])('testing %s', () => {
  it('hello world', () => {
    expect(true).toBe(true)
  })

  it.each([3, 4])('testing test %s', (a) => {
    expect(a).toBe(a)
  })
})
