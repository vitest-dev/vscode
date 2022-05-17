import { describe, expect, it } from 'vitest'
import { add } from '../src/add'

describe('addition', () => {
  describe('test suit', () => {
    it('add', () => {
      console.log('=================')
      console.log('Console Output')
      expect(add(1, 1)).toBe(2)
    })

    it.skip('skipped', () => {
      expect(1 + 1).toBe(3)
    })

    it.todo('todo')
    it('same name', () => {})
  })
})

describe('testing', () => {
  it('run', () => {
    const a = 10
    expect(a).toBe(10)
  })

  it('mul', () => {
    expect(5 * 5).toBe(25)
  })
})
