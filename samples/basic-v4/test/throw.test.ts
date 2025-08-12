import { describe, expect, it } from 'vitest';
import { addError } from '../src/add';

describe('throw error', () => {
  it('passes expecting an error to be thrown', () => {
    expect(()=>addError(1, 1)).toThrow()
  })

  it('fails with error thrown', () => {
    expect(addError(1, 1)).toBe(2)
  })
})
