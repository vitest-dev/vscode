import { describe, expect, it, test, } from 'vitest'

describe('testing', (a) => {
  it.each([
    1, 2, 3
  ])('run %i', (a) => {
    expect(a).toBe(a)
  })
  it.each([
    [1, 1], [2, 2], [3, 3]
  ])('run mul %i', (a,b) => {
    expect(a * a).toBe(b)
  })
  test.each([
    ["test1", 1],
    ["test2", 2],
    ["test3", 3],
  ])(`%s => %i`, (a, b) => {
    expect(a.at(-1)).toBe(`${b}`)
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
