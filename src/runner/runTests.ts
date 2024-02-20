import path from 'node:path'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, ParsedStack, Task, TaskResult } from 'vitest'
import type { VitestAPI, VitestFolderAPI } from '../api'
import { gatherTestItemsFromWorkspace } from '../runHandler'
import type { TestData } from '../TestData'
import { TestCase, TestDescribe, TestFile, WEAKMAP_TEST_DATA } from '../TestData'
import { log } from '../log'
import type { TestFileDiscoverer } from '../discover'

class StateManager {
  taskIdToTestItem = new Map<string, TestData>()

  setTestItem(taskId: string, testItem: TestData) {
    this.taskIdToTestItem.set(taskId, testItem)
  }
}

function getFilepathFromTask(task: Task) {
  if ('filepath' in task)
    return task.filepath
  return task.file?.filepath
}

function matchTestItemToTaskId(tests: Set<TestData>, task: Task): TestData | null {
  for (const data of tests) {
    const taskFilepath = getFilepathFromTask(task)
    if (taskFilepath && data.getFilePath() === taskFilepath) {
      if (task.type === 'suite' && !(data instanceof TestDescribe) && !(data instanceof TestFile))
        continue
      if (task.type !== 'suite' && !(data instanceof TestCase))
        continue
      // test files with matching paths are considered to be the same
      if (data instanceof TestFile) {
        tests.delete(data)
        return data
      }
      if (data.pattern === task.name) {
        tests.delete(data)
        return data
      }
    }
  }
  return null
}

function recursiveFlatTestData(test: TestData, data: Set<TestData> = new Set()): Set<TestData> {
  if (data.has(test))
    return data
  data.add(test)
  if (test instanceof TestDescribe || test instanceof TestFile)
    test.children.forEach(child => recursiveFlatTestData(child, data))
  return data
}

function flatTestData(test: TestData, data: Set<TestData> = new Set()): Set<TestData> {
  if (test instanceof TestFile)
    return recursiveFlatTestData(test, data)

  return recursiveFlatTestData(WEAKMAP_TEST_DATA.get(test.fileItem)!, data)
}

function getPatternFromTestItem(test: vscode.TestItem, pattern = '') {
  const data = WEAKMAP_TEST_DATA.get(test)!
  if (data instanceof TestFile || !test.parent)
    return pattern.trimStart()
  return getPatternFromTestItem(
    test.parent,
    pattern ? ` ${data.pattern} ${pattern}` : data.pattern,
  )
}

function formatTestPattern(tests: vscode.TestItem[]) {
  if (!tests.length || tests.length > 1)
    return
  const data = WEAKMAP_TEST_DATA.get(tests[0])!
  if (data instanceof TestFile)
    return
  const testNameLabel = getPatternFromTestItem(tests[0])
  const testNamePattern = testNameLabel.replace(/[$^+?()[\]"]/g, '\\$&')
  if (data instanceof TestCase)
    return `^\\s*${testNamePattern}$`
  return `^\\s*${testNamePattern} .+`
}

class TestRunner {
  private state = new StateManager()

  constructor(
    private readonly testRun: vscode.TestRun,
    private readonly ctrl: vscode.TestController,
    private readonly api: VitestFolderAPI,
    private readonly discoverer: TestFileDiscoverer,
  ) {}

  private hangingTestItems = new Set<TestFile>()

  async runFiles(tests: vscode.TestItem[]) {
    tests.forEach((test) => {
      flatTestData(WEAKMAP_TEST_DATA.get(test)!, this.hangingTestItems)
    })

    this.api.onConsoleLog(({ content, taskId }) => {
      const test = taskId ? this.state.taskIdToTestItem.get(taskId) : undefined
      this.testRun.appendOutput(content.replace(/(?<!\r)\n/g, '\r\n'), undefined, test?.item)
    })

    this.api.onCollected((files) => {
      if (!files)
        return
      const tasks = getTasks(files)
      tasks.forEach((task) => {
        const test = this.state.taskIdToTestItem.get(task.id) || matchTestItemToTaskId(this.hangingTestItems, task)
        if (!test)
          return

        this.state.setTestItem(task.id, test)
        if (task.mode === 'skip' || task.mode === 'todo')
          this.testRun.skipped(test.item)
        else
          this.markResult(test.item, task.result)
      })
    })

    this.api.onTaskUpdate((packs) => {
      packs.forEach(([id, result]) => {
        const test = this.state.taskIdToTestItem.get(id)
        if (!test)
          return
        this.markResult(test.item, result)
      })
    })

    this.api.onFinished((files, errors) => {
      errors?.forEach((error: any) => {
        if (typeof error === 'object' && error && error.stack)
          this.testRun.appendOutput(error.stack.replace(/(?<!\r)\n/g, '\r\n'))
      })

      getTasks(files).forEach((task) => {
        const test = this.state.taskIdToTestItem.get(task.id) || matchTestItemToTaskId(this.hangingTestItems, task)
        if (!test)
          return
        if (!task.result)
          this.testRun.skipped(test.item)
        else
          this.markResult(test.item, task.result)
      })

      this.hangingTestItems.forEach((test) => {
        this.testRun.skipped(test.item)
        log.info('Test was not found in the result', test.getFilePath(), test.pattern)
      })
      this.hangingTestItems.clear()
      this.api.clearListeners()
    })

    const testNamePattern = formatTestPattern(tests)
    const files = tests?.map(test => test.uri!.fsPath) || []

    log.info('Running tests', ...files, testNamePattern ? `with a pattern "${testNamePattern}"` : '')

    await this.api.runFiles(files, testNamePattern)
  }

  private markResult(test: vscode.TestItem, result?: TaskResult) {
    if (!result) {
      this.testRun.started(test)
      return
    }
    switch (result.state) {
      case 'fail': {
        const errors = result.errors?.map(err => testMessageForTestError(test, err)) || []
        this.testRun.errored(test, errors, result.duration)
        break
      }
      case 'pass': {
        this.testRun.passed(test, result.duration)
        break
      }
      case 'todo':
      case 'skip': {
        this.testRun.skipped(test)
        break
      }
      case 'only':
      case 'run': {
        this.testRun.started(test)
        break
      }
      default:
        log.error('Unknown test result for', `${test.label}: ${result.state}`)
    }
  }
}

export async function runTest(
  ctrl: vscode.TestController,
  api: VitestAPI,
  discoverer: TestFileDiscoverer,

  request: vscode.TestRunRequest,
  _token: vscode.CancellationToken,
) {
  const testRun = ctrl.createTestRun(request)

  await Promise.all(api.map((folderAPI) => {
    const runner = new TestRunner(testRun, ctrl, folderAPI, discoverer)
    return runner.runFiles(gatherTestItemsFromWorkspace(request.include ?? [], folderAPI.folder.uri.fsPath))
  }))

  testRun.end()
}

function testMessageForTestError(testItem: vscode.TestItem, error: ErrorWithDiff | undefined): vscode.TestMessage {
  let testMessage
  if (error?.actual != null && error?.expected != null && error?.actual !== 'undefined' && error?.expected !== 'undefined')
    testMessage = vscode.TestMessage.diff(error?.message ?? '', error.expected, error.actual)
  else
    testMessage = new vscode.TestMessage(error?.message ?? '')

  const location = parseLocationFromStacks(testItem, error?.stacks ?? [])
  if (location) {
    const position = new vscode.Position(location.line - 1, location.column - 1)
    testMessage.location = new vscode.Location(vscode.Uri.file(location.path), position)
  }
  return testMessage
}

function getSourceFilepathAndLocationFromStack(stack: ParsedStack): { sourceFilepath?: string; line: number; column: number } {
  return {
    sourceFilepath: stack.file.replace(/\//g, path.sep),
    line: stack.line,
    column: stack.column,
  }
}

export interface DebuggerLocation {
  path: string
  line: number
  column: number
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
