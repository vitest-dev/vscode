import { describe, expect, it } from 'vitest'

describe('fixture', () => {
  describe('__fixtures__/file.spec.ts 1', () => {
    it('snapshot', () => {
      expect('').toMatchSnapshot()
    })
    it('snapshot_1', () => {
      expect('').toMatchSnapshot()
    })
  })

  describe('__fixtures__/file.spec.ts 2', () => {
    it('snapshot_1', () => {
      expect('').toMatchSnapshot()
    })
    it('snapshot_2', () => {
      expect('').toMatchSnapshot()
    })
    it('snapshot', () => {
      expect('\nsome content\n').toMatchSnapshot()
    })
  })

  // same name it
  describe('__fixtures__/file.spec.ts 2', () => {
    it('snapshot_1', () => {
      expect('').toMatchSnapshot()
    })
    it('snapshot_2', () => {
      expect('').toMatchSnapshot()
    })
    it('snapshot', () => {
      expect('').toMatchSnapshot()
    })
  })
  // same name expect
  it('snapshot_2', () => {
    expect('').toMatchSnapshot()
  })
})

describe('fixture2', () => {
  it('__fixtures__/file.spec.ts 4', () => {
    expect('').toMatchSnapshot()
    expect('').toMatchSnapshot()
  })
})

it('fixture2', () => {
  expect('').toMatchSnapshot()
})
