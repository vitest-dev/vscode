import { expect } from 'chai'
import { TestRunner } from '../src/pure/runner'
import * as platformConstants from '../src/pure/platform'

describe('TestRunner', () => {
  const prevIsWindows = platformConstants.isWindows

  afterEach(() => {
    Object.defineProperty(platformConstants, 'isWindows', { value: prevIsWindows, writable: true })
  })

  const testCases = [
    { isWindows: false, useCustomStartProcess: false, expectedArgs: `vitest,abc.spec.ts,-t,a (b) "c" d` },
    { isWindows: false, useCustomStartProcess: true, expectedArgs: `vitest,abc.spec.ts,-t,a (b) "c" d` },
    { isWindows: true, useCustomStartProcess: false, expectedArgs: `vitest,abc.spec.ts,-t,"a (b) \\"c\\" d"` },
    { isWindows: true, useCustomStartProcess: true, expectedArgs: `vitest,abc.spec.ts,-t,a (b) "c" d` },
  ]
  testCases.forEach((testCase) => {
    const { isWindows, useCustomStartProcess, expectedArgs } = testCase
    describe(
      `scheduleRun wrap test patterns if needed, (isWindows: ${isWindows}, customStartProcess: ${useCustomStartProcess})`,
      async () => {
        Object.defineProperty(platformConstants, 'isWindows', { value: isWindows, writable: true })
        const workspacePath = '/test'
        const testFiles = ['abc.spec.ts']
        const testNamePattern = 'a (b) "c" d'
        const customStartProcess = useCustomStartProcess ? () => {} : undefined

        const { testResultFiles, output } = await new TestRunner(workspacePath, undefined).scheduleRun(
          testFiles,
          testNamePattern,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          customStartProcess,
        )

        expect(testResultFiles).to.not.equal(undefined)
        expect(output).to.equal(`vitest.cmd=npx vitest.args=${expectedArgs} workspace=/test customStartProcess=${useCustomStartProcess}`)
      },
    )
  })
})
