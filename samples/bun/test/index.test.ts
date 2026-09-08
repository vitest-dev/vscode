import { describe, it, expect } from 'vitest'
import { greet, add } from '../src/index'

describe('greet', () => {
  it('should greet by name', () => {
    expect(greet('World')).toBe('Hello, World!')
  })

  it('should handle empty string', () => {
    expect(greet('')).toBe('Hello, !')
  })
})

describe('add', () => {
  it('should add two numbers', () => {
    expect(add(1, 2)).toBe(3)
  })

  it('should handle negative numbers', () => {
    expect(add(-1, -2)).toBe(-3)
  })
})
