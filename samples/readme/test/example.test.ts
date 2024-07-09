import { describe, expect, test } from 'vitest'
import { add } from '../src/add.js'

describe('test suite', () => {
  test('passing test', () => {
    expect(add(1, 1)).toBe(2)
  })

  test('failing test', () => {
    expect(add(2, 2)).toBe(5)
  })

  test.skip('skipped test', () => {
    expect(add(3, 3)).toBe(6)
  })

  // test('not run', () => {
  //   expect(add(4, 4)).toBe(8)
  // })
})