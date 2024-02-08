import { describe, expect, it, test, } from 'vitest'

describe('testing', (a) => {
  it.each([
    [1, 1], [2, 2], [3, 3]
  ])(`all pass: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 1], [2, 1], [3, 1]
  ])(`first pass: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 1], [2, 2], [3, 1]
  ])(`last pass: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 1], [2, 2], [3, 1]
  ])(`first fail: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 1], [2, 2], [3, 1]
  ])(`last fail: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    [1, 0], [2, 0], [3, 0]
  ])(`all fail: %i => %i`, (a, b) => {
    expect(a).toBe(b)
  })
  it.each([
    1, 2, 3
  ])('run %i', (a) => {
    expect(a).toBe(a)
  })
  it.each([
    [1, 1], [2, 4], [3, 9]
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
  test.each([
    { input: 1, add: 1, sum: 2 },
    { input: 2, add: 2, sum: 4 },
  ])('$input + $add = $sum', ({ input, add, sum }) => {
    expect(input + add).toBe(sum)
  })
})

describe('ambiguous', () => {
  test.each([
    ['test', 1],
  ])(`%s => %i`, (a, b) => {
    expect(b).toBe(1)
  })
  test('test', () => {
    expect(1).toBe(1)
  })
})
