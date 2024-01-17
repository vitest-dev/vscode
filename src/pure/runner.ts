import { spawn } from 'child_process'

import { chunksToLinesAsync } from '@rauschma/stringio'
import type { File } from 'vitest'
import type { CancellationToken } from 'vscode'
import {
  filterColorFormatOutput,
  sanitizeFilePath,
} from './utils'
import { isWindows } from './platform'
import type { StartConfig } from './ApiProcess'
import { runVitestWithApi } from './ApiProcess'

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
    log: { info: (msg: string) => void; error: (line: string) => void } = { info: () => {}, error: console.error },
    workspaceEnv: Record<string, string> = {},
    vitestCommand: { cmd: string; args: string[] } = this.defaultVitestCommand
      ? this.defaultVitestCommand
      : { cmd: 'npx', args: ['vitest'] },
    updateSnapshot = false,
    onUpdate?: (files: File[]) => void,
    customStartProcess?: (config: StartConfig) => void,
    cancellation?: CancellationToken,
  ): Promise<{ testResultFiles: File[]; output: string }> {
    const command = vitestCommand.cmd
    const args = [
      ...vitestCommand.args,
      ...(testFile ? testFile.map(f => sanitizeFilePath(f)) : []),
    ] as string[]
    if (updateSnapshot)
      args.push('--update')

    if (testNamePattern) {
      // Vitest's test name pattern is a regex, so we need to escape any special regex characters.
      // Additionally, when a custom start process is not used on Windows, child_process.spawn is used with shell: true.
      // That disables automatic quoting/escaping of arguments, requiring us to manually perform that here as well.
      if (isWindows && !customStartProcess)
        args.push('-t', `"${testNamePattern.replace(/[$^+?()[\]"]/g, '\\$&')}"`)
      else
        args.push('-t', testNamePattern.replace(/[$^+?()[\]"]/g, '\\$&'))
    }

    const workspacePath = sanitizeFilePath(this.workspacePath)
    const outputs: string[] = []
    const env = { ...process.env, ...workspaceEnv }
    let testResultFiles = [] as File[]
    const output = await runVitestWithApi({ cmd: sanitizeFilePath(command), args }, this.workspacePath, {
      log: (line) => {
        log.info(`${filterColorFormatOutput(line.trimEnd())}\r\n`)
        outputs.push(filterColorFormatOutput(line))
      },
      onFinished: (files) => {
        if (files == null) {
          if (!cancellation?.isCancellationRequested)
            handleError()
          return
        }

        testResultFiles = files
      },
      onCollected: (files) => {
        files && onUpdate && onUpdate(files)
      },
      onUpdate,
    }, customStartProcess, cancellation)

    return { testResultFiles, output }

    async function handleError() {
      const prefix = '\n'
        + 'Failed to get any result\n'
        + '( Vitest should be configured to be able to run from project root )\n\n'
        + 'Error when running\r\n'
        + `    ${`${command} ${args.join(' ')}`}\n\n`
        + `cwd: ${workspacePath}\r\n`
        + `node: ${await getNodeVersion()}\r\n`
        + `env.PATH: ${env.PATH}\r\n`

      log.error(prefix)
      log.error(outputs.join('\n'))
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
