import { spawn } from 'child_process'
import { tmpdir } from 'os'
import * as path from 'path'

import { chunksToLinesAsync } from '@rauschma/stringio'
import type { File } from 'vitest'
import {
  filterColorFormatOutput,
  sanitizeFilePath,
} from './utils'
import { isWindows } from './platform'
import { runVitestWithApi } from './ApiProcess'

export function getDebuggerConfig() {}

let i = 0
const suffix = (0 | (Math.random() * 1000000)).toString(36)
export function getTempPath(): string {
  return sanitizeFilePath(
    path.join(tmpdir(), `vitest-report-${suffix}${i++}.json`),
  )
}

type Status = 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled'
type Milliseconds = number
interface FormattedAssertionResult {
  ancestorTitles: Array<string>
  fullName: string
  status: Status
  title: string
  duration?: Milliseconds | null
  failureMessages: Array<string>
  // location?: Callsite | null
}

interface FormattedTestResult {
  message: string
  name: string
  status: 'failed' | 'passed'
  startTime: number
  endTime: number
  assertionResults: Array<FormattedAssertionResult>
  // summary: string
  // coverage: unknown
}

export interface FormattedTestResults {
  numFailedTests: number
  numFailedTestSuites: number
  numPassedTests: number
  numPassedTestSuites: number
  numPendingTests: number
  numPendingTestSuites: number
  numTodoTests: number
  numTotalTests: number
  numTotalTestSuites: number
  startTime: number
  success: boolean
  testResults: Array<FormattedTestResult>
  // coverageMap?: CoverageMap | null | undefined
  // numRuntimeErrorTestSuites: number
  // snapshot: SnapshotSummary
  // wasInterrupted: boolean
}

export class TestRunner {
  constructor(
    private workspacePath: string,
    private defaultVitestCommand: { cmd: string; args: string[] } | undefined,
  ) {}

  async scheduleRun(
    testFile: string[] | undefined,
    testNamePattern: string | undefined,
    log: (msg: string) => void = () => {},
    workspaceEnv: Record<string, string> = {},
    vitestCommand: { cmd: string; args: string[] } = this.defaultVitestCommand
      ? this.defaultVitestCommand
      : { cmd: 'npx', args: ['vitest'] },
    updateSnapshot = false,
  ): Promise<File[]> {
    const command = vitestCommand.cmd
    const args = [
      ...vitestCommand.args,
      ...(testFile ? testFile.map(f => sanitizeFilePath(f)) : []),
    ] as string[]
    if (updateSnapshot)
      args.push('--update')

    if (testNamePattern) {
      if (isWindows)
        args.push('-t', `"${testNamePattern}"`)
      else
        args.push('-t', testNamePattern)
    }

    const workspacePath = sanitizeFilePath(this.workspacePath)
    let error: any
    const outputs: string[] = []
    const env = { ...process.env, ...workspaceEnv }
    let ans = [] as File[]
    try {
      await runVitestWithApi({ cmd: command, args }, this.workspacePath, {
        log: (line) => {
          log(`${filterColorFormatOutput(line.trimEnd())}\r\n`)
          outputs.push(filterColorFormatOutput(line))
        },
        onFinished: (files) => {
          if (files == null)
            throw new Error('Vitest failed to return any files')

          ans = files
        },
      })
    }
    catch (e) {
      error = e
      handleError()
    }

    return ans

    async function handleError() {
      const prefix = '\n'
        + '( Vitest should be configured to be able to run from project root )\n\n'
        + 'Error when running\r\n'
        + `    ${`${command} ${args.join(' ')}`}\n\n`
        + `cwd: ${workspacePath}\r\n`
        + `node: ${await getNodeVersion()}\r\n`
        + `env.PATH: ${env.PATH}\r\n`
      if (error) {
        console.error('scheduleRun error', error.toString())
        console.error(error.stack)
        const e = error
        error = new Error(`${prefix}\r\n${error.toString()}`)
        error.stack = e.stack
      }
      else {
        error = new Error(
          `${prefix}\n\n------\n\nLog:\n${outputs.join('\r\n')}`,
        )
      }

      console.error(outputs.join('\n'))
      throw error
    }
  }
}

export async function getNodeVersion() {
  const process = spawn('node', ['-v'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // eslint-disable-next-line no-unreachable-loop
  for await (const line of chunksToLinesAsync(process.stdout))
    return line
}
