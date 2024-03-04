import { expect } from 'chai'
import { spawnVitestVersion } from '../src/pure/utils'
import { escapeTestPattern } from "../src/pure/runner"

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

describe(escapeTestPattern.name, () => {
  const testPattern = 'a (b) "c" d';
  const testCases = [
    {isWindows: false, useCustomStartProcess: false, expected: `a (b) "c" d`},
    {isWindows: false, useCustomStartProcess: true,  expected: `a (b) "c" d`},
    {isWindows: true,  useCustomStartProcess: false, expected: `"a (b) \\"c\\" d"`},
    {isWindows: true,  useCustomStartProcess: true,  expected: `a (b) "c" d`},
  ]
  testCases.forEach((testCase) => {
    it(JSON.stringify(testCase), () => {
      const { isWindows, useCustomStartProcess } = testCase;
      const actual = escapeTestPattern({ testPattern, isWindows, useCustomStartProcess });
      expect(actual).to.equal(testCase.expected);
    })
  })
})
