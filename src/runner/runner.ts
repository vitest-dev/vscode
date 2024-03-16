import path from 'node:path'
import stripAnsi from 'strip-ansi'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, ParsedStack, Task, TaskResult } from 'vitest'
import { normalize } from 'pathe'
import { type TestData, TestFolder, getTestData } from '../testTreeData'
import type { TestTree } from '../testTree'
import type { VitestFolderAPI } from '../api'
import { log } from '../log'
import { type DebugSessionAPI, startDebugSession } from '../debug/startSession'

export class TestRunner extends vscode.Disposable {
  private testRun?: vscode.TestRun
  private debug?: DebugSessionAPI

  private testRunRequests = new Set<vscode.TestRunRequest>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly tree: TestTree,
    private readonly api: VitestFolderAPI,
  ) {
    super(() => {
      api.clearListeners()
      this.endTestRuns()
    })

    api.onWatcherRerun(() => this.startTestRun())

    api.onTaskUpdate((packs) => {
      packs.forEach(([testId, result]) => {
        const test = this.tree.getTestDataByTaskId(testId)
        if (!test) {
          log.error('Cannot find task during onTaskUpdate', testId)
          return
        }
        this.markResult(test.item, result)
      })
    })

    api.onCollected((files) => {
      if (!files)
        return
      files.forEach(file => this.tree.collectFile(this.api, file))
      const run = this.testRun
      if (!run)
        return
      this.forEachTask(files, (task, data) => {
        if (task.mode === 'skip' || task.mode === 'todo')
          run.skipped(data.item)
        else
          this.markResult(data.item, task.result, task)
      })
    })

    api.onFinished((files = []) => {
      this.forEachTask(files, (task, data) => {
        if (!task.result)
          this.testRun?.skipped(data.item)
        else
          this.markResult(data.item, task.result, task)
      })

      this.endTestRuns()
    })

    api.onConsoleLog(({ content, taskId }) => {
      const data = taskId ? tree.getTestDataByTaskId(taskId) : undefined
      if (this.testRun) {
        this.testRun.appendOutput(
          content.replace(/(?<!\r)\n/g, '\r\n'),
          undefined,
          data?.item,
        )
      }
      else {
        log.info('[TEST]', content)
      }
    })
  }

  public async debugTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    await this.debug?.stop()

    this.debug = await startDebugSession(
      this.api,
      this,
      request,
      token,
    )
  }

  public async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.testRunRequests.add(request)
    token.onCancellationRequested(() => {
      this.api.cancelRun()
      this.testRunRequests.delete(request)
      this.endTestRuns()
    })

    const tests = [...this.testRunRequests.values()].flatMap(r => r.include || [])

    if (!tests.length) {
      await this.api.runFiles()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      const files = getTestFiles(tests)
      await this.api.runFiles(files, testNamePatern)
    }

    if (!request.continuous)
      this.testRunRequests.delete(request)
  }

  private enqueueTests(testRun: vscode.TestRun, tests: vscode.TestItemCollection) {
    for (const [_, item] of tests) {
      testRun.enqueued(item)
      if (item.children.size)
        this.enqueueTests(testRun, item.children)
    }
  }

  private startTestRun() {
    // TODO: refactor to use different requests, otherwise test run doesn't mark the result value!
    const currentRequest = this.testRunRequests.values().next().value as vscode.TestRunRequest | undefined
    if (currentRequest) {
      // report only if continuous mode is enabled or this is the first run
      if (!this.testRun || currentRequest.continuous) {
        const testName = currentRequest.include?.length === 1 ? currentRequest.include[0].label : undefined
        const name = currentRequest.include?.length ? testName : 'Running all tests'
        this.testRun = this.controller.createTestRun(currentRequest, name)
        if (currentRequest.include) {
          currentRequest.include.forEach((testItem) => {
            this.enqueueTests(this.testRun!, testItem.children)
          })
        }
        else {
          const workspaceFolderPath = normalize(this.api.workspaceFolder.uri.fsPath)
          this.enqueueTests(
            this.testRun,
            this.tree.getOrCreateFolderTestItem(workspaceFolderPath).children,
          )
        }
      }
    }
  }

  public endTestRuns() {
    this.testRun?.end()
    this.testRun = undefined
  }

  private forEachTask(tasks: Task[], fn: (task: Task, test: TestData) => void) {
    getTasks(tasks).forEach((task) => {
      const test = this.tree.getTestDataByTask(task)
      if (!test) {
        log.error(`Test data not found for "${task.name}"`)
        return
      }
      fn(task, test)
    })
  }

  private markResult(test: vscode.TestItem, result?: TaskResult, task?: Task) {
    if (!this.testRun)
      return
    if (!result) {
      this.testRun.started(test)
      return
    }
    switch (result.state) {
      case 'fail': {
        // error in a suite doesn't mean test fail
        if (task?.type === 'suite') {
          const errors = result.errors?.map(err =>
            new vscode.TestMessage(err.stack || err.message),
          )
          if (!errors)
            return
          test.error = errors.map(e => e.message.toString()).join('\n')
          this.testRun.errored(test, errors, result.duration)
          return
        }
        const errors = result.errors?.map(err =>
          testMessageForTestError(test, err),
        ) || []
        this.testRun.failed(test, errors, result.duration)
        break
      }
      case 'pass':
        this.testRun.passed(test, result.duration)
        break
      case 'todo':
      case 'skip':
        this.testRun.skipped(test)
        break
      case 'only':
      case 'run':
        this.testRun.started(test)
        break
      default: {
        const _never: never = result.state
        log.error('Unknown test result for', `${test.label}: ${result.state}`)
      }
    }
  }
}

function testMessageForTestError(testItem: vscode.TestItem, error: ErrorWithDiff | undefined): vscode.TestMessage {
  if (!error)
    return new vscode.TestMessage('Unknown error')

  let testMessage
  if (error.actual != null && error.expected != null && error.actual !== 'undefined' && error.expected !== 'undefined')
    testMessage = vscode.TestMessage.diff(stripAnsi(error.message) ?? '', error.expected, error.actual)
  else
    testMessage = new vscode.TestMessage(stripAnsi(error.message) ?? '')

  const location = parseLocationFromStacks(testItem, error.stacks ?? [])
  if (location) {
    const position = new vscode.Position(location.line - 1, location.column - 1)
    testMessage.location = new vscode.Location(vscode.Uri.file(location.path), position)
  }
  return testMessage
}

export interface DebuggerLocation {
  path: string
  line: number
  column: number
}

function getSourceFilepathAndLocationFromStack(stack: ParsedStack): { sourceFilepath?: string; line: number; column: number } {
  return {
    sourceFilepath: stack.file.replace(/\//g, path.sep),
    line: stack.line,
    column: stack.column,
  }
}

function parseLocationFromStacks(testItem: vscode.TestItem, stacks: ParsedStack[]): DebuggerLocation | undefined {
  if (stacks.length === 0)
    return undefined

  const targetFilepath = testItem.uri!.fsPath
  for (const stack of stacks) {
    const { sourceFilepath, line, column } = getSourceFilepathAndLocationFromStack(stack)
    if (sourceFilepath !== targetFilepath || Number.isNaN(column) || Number.isNaN(line))
      continue

    return {
      path: sourceFilepath,
      line,
      column,
    }
  }
}

function getTestFiles(tests: readonly vscode.TestItem[]) {
  return Array.from(
    new Set(tests.map((test) => {
      const data = getTestData(test)
      const fsPath = test.uri!.fsPath
      if (data instanceof TestFolder)
        return `${fsPath}/`
      return fsPath
    }).filter(Boolean) as string[]),
  )
}

function formatTestPattern(tests: readonly vscode.TestItem[]) {
  const patterns: string[] = []
  for (const test of tests) {
    const data = getTestData(test)!
    if (!('getTestNamePattern' in data))
      continue
    patterns.push(data.getTestNamePattern())
  }
  if (!patterns.length)
    return undefined
  return patterns.join('|')
}
