import { describe, expect, it } from 'vitest'

describe('snapshots', () => {
  it('string', () => {
    expect('bc').toMatchSnapshot()
  })
  it('async', async () => {
    await new Promise(resolve => setTimeout(resolve, 200))
    expect('bc').toMatchSnapshot()
  })
})
