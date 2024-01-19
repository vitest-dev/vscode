import { describe, expect, it, test, } from 'vitest'

describe.each([
  1, 2, 3
])('testing %i', (a) => {
  it.each([
    1, 2, 3
  ])('run %i', (b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 1], [2, 2], [3, 3]
  ])('run mul %i', (b, c) => {
    expect(a * b).toBe(c)
  })
  test.each`
    a               | b      | expected
    ${1}            | ${1}   | ${2}
    ${'a'}          | ${'b'} | ${'ab'}
    ${[]}           | ${'b'} | ${'b'}
    ${{}}           | ${'b'} | ${'[object Object]b'}
    ${{ asd: 1 }}   | ${'b'} | ${'[object Object]b'}
  `('returns $expected when $a is added $b', ({ a, b, expected }) => {
    expect(a + b).toBe(expected)
  })
})
