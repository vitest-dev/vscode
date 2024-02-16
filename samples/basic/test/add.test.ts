import { describe, expect, it } from 'vitest'
import { add, sum } from '../src/add'

describe('addition', () => {
  it('add', () => {
    expect(add(1, 1)).toBe(2)
  })

  it('sum', () => {
    expect(sum(0, 10)).toBe(55)
  })

  it.skip('skipped', () => {
    expect(1 + 2).toBe(3)
  })

  it.todo('todo')
  it('async task', async () => {
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  it('async task 0.5s', async () => {
    await new Promise(resolve => setTimeout(resolve, 500))
  })

  it('async task 1s', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  it('long task', () => {
    let sum = 0
    for (let i = 0; i < 2e8; i++)
      sum += i

    expect(sum).toBeGreaterThan(1)
  })
})

describe('testing', () => {
  it('run', () => {
    const a = 10
    console.log("foo", { a });
    expect(a).toBe(10)
  })

  it('mul', () => {
    console.log("hey1");
    console.log("hey2");
    console.log("hey3");
    expect(5 * 5).toBe(25)
  })
})
