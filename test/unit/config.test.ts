import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { expect } from 'chai'
import { resolveConfigPath } from '../../src/config'

it('correctly resolves ~', () => {
  expect(resolveConfigPath('~/test')).to.equal(
    resolve(homedir(), 'test'),
  )
})
