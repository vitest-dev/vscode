import { afterEach, describe, expect, test, vi } from 'vitest'
import { TestRunner } from '../src/pure/runner'
import * as platformConstants from '../src/pure/platform'

// Mock vscode ("pure" modules aren't quite pure)
vi.mock('vscode', () => {
  return {
    default: { myDefaultKey: vi.fn() },
    namedExport: vi.fn(),
    window: {
      createOutputChannel: () => {
        return {
          appendLine: vi.fn(),
        }
      },
    },
  }
})

// Mock config
vi.mock('../src/config', () => {
  return {
    getConfig: () => {
      return {
        env: null,
      }
    },
  }
})

// Mock runVitestWithApi, causing it to return its arguments as its output to allow us to assert their values
vi.mock('../src/pure/ApiProcess', () => {
  return {
    runVitestWithApi: (
      vitest: { cmd: string; args: string[] },
      workspace: string,
      handlers: any,
      customStartProcess?: (config: any) => void,
    ) => {
      return `vitest.cmd=${vitest.cmd}`
        + ` vitest.args=${vitest.args}`
        + ` workspace=${workspace}`
        + ` customStartProcess=${!!customStartProcess}`
    },
  }
})

describe('TestRunner', () => {
  const prevIsWindows = platformConstants.isWindows

  afterEach(() => {
    Object.defineProperty(platformConstants, 'isWindows', { value: prevIsWindows, writable: true })
  })

  test.each([
    [false, false, 'vitest,abc.spec.ts,-t,a \\(b\\) \\\"c\\\" d'],
    [false, true, 'vitest,abc.spec.ts,-t,a \\(b\\) \\\"c\\\" d'],
    [true, false, 'vitest,abc.spec.ts,-t,\"a \\(b\\) \\\"c\\\" d\"'],
    [true, true, 'vitest,abc.spec.ts,-t,a \\(b\\) \\\"c\\\" d'],
  ])('scheduleRun properly escapes arguments (isWindows: %s, customStartProcess: %s)', async (isWindows, useCustomStartProcess, expectedArgs) => {
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

    expect(testResultFiles).toBeDefined()
    expect(output).toBe(`vitest.cmd=npx vitest.args=${expectedArgs} workspace=/test customStartProcess=${useCustomStartProcess}`)
  })
})
