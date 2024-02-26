import { expect } from 'chai'
import { spawnVitestVersion } from '../src/pure/utils'

describe('utils', () => {
  describe('spawnVitestVersion', () => {
    it('should return undefined when passing an unkown command', async () => {
      const result = await spawnVitestVersion('unknown-command', ['xxx'], {})
      expect(result).to.equal(undefined)
    })

    it('should return undefined when the commmand don\'t return any version', async () => {
      const result = await spawnVitestVersion('/bin/ls', ['-l'], {})
      expect(result).to.equal(undefined)
    })
  })
})
