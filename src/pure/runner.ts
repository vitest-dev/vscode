import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import * as path from 'path'
import { readFile } from 'fs-extra'

import { chunksToLinesAsync } from '@rauschma/stringio'
import {
  execWithLog,
  filterColorFormatOutput,
  sanitizeFilePath,
} from './utils'
import { isWindows } from './platform'

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
    private vitestCommand: { cmd: string; args: string[] } | undefined,
  ) {}

  async scheduleRun(
    testFile: string[] | undefined,
    testNamePattern: string | undefined,
    log: (msg: string) => void = () => {},
    workspaceEnv: Record<string, string> = {},
    vitestCommand: { cmd: string; args: string[] } = this.vitestCommand
      ? this.vitestCommand
      : { cmd: 'npx', args: ['vitest'] },
    updateSnapshot = false,
  ): Promise<FormattedTestResults> {
    const path = getTempPath()
    const command = vitestCommand.cmd
    const args = [
      ...vitestCommand.args,
      ...(testFile ? testFile.map(f => sanitizeFilePath(f)) : []),
      '--reporter=json',
      '--reporter=verbose',
      '--outputFile',
      path,
      '--run',
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
    try {
      function _log(line: string) {
        log(`${filterColorFormatOutput(line.trimEnd())}\r\n`)
        outputs.push(filterColorFormatOutput(line))
      }

      // it will throw when test failed or the testing is failed to run
      await execWithLog(command, args, {
        env,
        cwd: workspacePath,
      }, _log, _log).promise
    }
    catch (e) {
      error = e
    }

    if (!existsSync(path))
      await handleError()

    const file = await readFile(path, 'utf-8')

    const out = JSON.parse(file) as FormattedTestResults
    if (out.testResults.length === 0)
      await handleError()

    return out

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
