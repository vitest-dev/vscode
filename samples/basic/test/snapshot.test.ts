import { describe, expect, it } from 'vitest'

describe('snapshots', () => {
  it('string', () => {
    expect('bc').toMatchSnapshot()
  })
})
