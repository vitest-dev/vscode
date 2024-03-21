import path, { normalize } from 'node:path'
import stripAnsi from 'strip-ansi'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, ParsedStack, Task, TaskResult } from 'vitest'
import { basename, dirname } from 'pathe'
import { type TestData, TestFile, TestFolder, getTestData } from '../testTreeData'
import type { TestTree } from '../testTree'
import type { VitestFolderAPI } from '../api'
import { log } from '../log'
import { type DebugSessionAPI, startDebugSession } from '../debug/startSession'

const WEAK_TEST_RUNS_DATA = new WeakMap<vscode.TestRun, TestRunData>()

class TestRunData {
  private constructor(
    public readonly run: vscode.TestRun,
    public readonly file: string,
    public readonly request: vscode.TestRunRequest,
  ) {}

  static register(
    run: vscode.TestRun,
    file: string,
    request: vscode.TestRunRequest,
  ) {
    return WEAK_TEST_RUNS_DATA.set(run, new TestRunData(run, file, request))
  }

  static get(run: vscode.TestRun) {
    return WEAK_TEST_RUNS_DATA.get(run)!
  }
}

export class TestRunner extends vscode.Disposable {
  private debug?: DebugSessionAPI

  private continuousRequests = new Set<vscode.TestRunRequest>()
  private simpleRequests = new Set<vscode.TestRunRequest>()

  private testRunRequests = new Map<vscode.TestRunRequest, vscode.TestRun[]>()

  // TODO: doesn't support "projects" - run every project because Vitest doesn't support
  // granular filters yet (coming in Vitest 1.4.1)
  private testRunsByFile = new Map<string, vscode.TestRun>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly tree: TestTree,
    private readonly api: VitestFolderAPI,
  ) {
    super(() => {
      api.clearListeners()
      this.endTestRuns()
    })

    api.onWatcherRerun(files => this.startTestRun(files))

    api.onTaskUpdate((packs) => {
      packs.forEach(([testId, result]) => {
        const test = this.tree.getTestDataByTaskId(testId)
        if (!test) {
          log.error('Cannot find task during onTaskUpdate', testId)
          return
        }
        const testRun = this.getTestRunByData(test)
        if (!testRun) {
          log.error('Cannot find test run for task', test.item.label)
          return
        }
        this.markResult(testRun, test.item, result)
      })
    })

    api.onCollected((files) => {
      if (!files)
        return
      files.forEach(file => this.tree.collectFile(this.api, file))
      this.forEachTask(files, (task, data) => {
        const testRun = this.getTestRunByData(data)
        if (!testRun) {
          log.error('Cannot find test run for task', task.name)
          return
        }
        if (task.mode === 'skip' || task.mode === 'todo')
          testRun.skipped(data.item)
        else
          this.markResult(testRun, data.item, task.result, task)
      })
    })

    api.onFinished((files = []) => {
      files.forEach((file) => {
        const data = this.tree.getTestDataByTask(file) as TestFile | undefined
        const testRun = data && this.getTestRunByData(data)
        if (testRun && data) {
          this.markResult(testRun, data.item, file.result, file)
          this.endTestRun(testRun)
        }
      })
    })

    api.onConsoleLog(({ content, taskId }) => {
      const data = taskId ? tree.getTestDataByTaskId(taskId) : undefined
      const testRun = data && this.getTestRunByData(data)
      if (testRun) {
        testRun.appendOutput(
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
    this.testRunRequests.set(request, [])

    token.onCancellationRequested(() => {
      this.endTestRuns(request)
    })

    const tests = [...this.testRunRequests.keys()].flatMap(r => r.include || [])

    if (!tests.length) {
      log.info(`Running all tests in ${basename(this.api.workspaceFolder.uri.fsPath)}`)
      await this.api.runFiles()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      const files = getTestFiles(tests)
      if (testNamePatern)
        log.info(`Running ${files.length} file(s) with name pattern: ${testNamePatern}`)
      else
        log.info(`Running ${files.length} file(s):`, files)
      await this.api.runFiles(files, testNamePatern, request.continuous)
    }

    if (!request.continuous)
      this.endTestRuns(request)
  }

  private enqueueRequest(testRun: vscode.TestRun, request: vscode.TestRunRequest) {
    if (request.include) {
      request.include.forEach((testItem) => {
        this.enqueueTests(testRun, testItem.children)
      })
    }
    else {
      const workspaceFolderPath = normalize(this.api.workspaceFolder.uri.fsPath)
      this.enqueueTests(
        testRun,
        this.tree.getOrCreateFolderTestItem(this.api, workspaceFolderPath).children,
      )
    }
  }

  private enqueueTests(testRun: vscode.TestRun, tests: vscode.TestItemCollection) {
    for (const [_, item] of tests) {
      if (item.children.size) {
        this.enqueueTests(testRun, item.children)
      }
      else {
        // enqueue only tests themselves, not folders
        // they will be queued automatically if children are enqueued
        testRun.enqueued(item)
      }
    }
  }

  private getTestRunByData(data: TestData): vscode.TestRun | null {
    if (data instanceof TestFolder)
      return null
    if (data instanceof TestFile)
      return this.testRunsByFile.get(data.filepath) || null

    if ('file' in data)
      return this.getTestRunByData(data.file)
    return null
  }

  private isFileIncluded(file: string, include: readonly vscode.TestItem[] | vscode.TestItemCollection) {
    for (const _item of include) {
      const item = 'id' in _item ? _item : _item[1]
      const data = getTestData(item)
      if (data instanceof TestFile) {
        if (data.filepath === file)
          return true
      }
      else if (data instanceof TestFolder) {
        if (this.isFileIncluded(file, item.children))
          return true
      }
      else {
        if (data.file.filepath === file)
          return true
      }
    }
    return false
  }

  private getTestRequestsByFile(file: string) {
    const requests: vscode.TestRunRequest[] = []

    this.testRunRequests.forEach((_, request) => {
      if (!request.include) {
        requests.push(request)
        return
      }

      if (this.isFileIncluded(file, request.include))
        requests.push(request)
    })
    return requests
  }

  private getTestFilesInFolder(path: string) {
    function getFiles(folder: vscode.TestItem): string[] {
      const files: string[] = []
      for (const [_, item] of folder.children) {
        const data = getTestData(item)
        if (data instanceof TestFile)
          files.push(data.filepath)
        else if (data instanceof TestFolder)
          files.push(...getFiles(item))
      }
      return files
    }

    const folder = this.tree.getOrCreateFolderTestItem(this.api, path)
    return getFiles(folder)
  }

  private startTestRun(files: string[]) {
    const request = new vscode.TestRunRequest() // ? create a single request instead for all continuous runs ?

    for (const file of files) {
      if (file[file.length - 1] === '/') {
        const files = this.getTestFilesInFolder(file)
        this.startTestRun(files)
        continue
      }
      const testRun = this.testRunsByFile.get(file)
      if (testRun)
        continue
      const requests = this.getTestRequestsByFile(file)
      if (requests.length > 1)
        log.info('Multiple test run requests for a single file', file)
      // it's possible to have no requests when collecting tests
      if (!requests.length) {
        log.info('No test run requests for file', file)
        continue
      }

      const request = requests[0]
      const base = basename(file)
      const dir = basename(dirname(file))
      const name = `${dir}${path.sep}${base}`
      const run = this.controller.createTestRun(request, name)

      TestRunData.register(run, file, request)

      this.testRunsByFile.set(file, run)
      const cachedRuns = this.testRunRequests.get(request) || []
      cachedRuns.push(run)
      this.testRunRequests.set(request, cachedRuns)
      // this.enqueueRequest(run, request)
    }
  }

  public endTestRun(run: vscode.TestRun) {
    const data = TestRunData.get(run)
    this.testRunsByFile.delete(data.file)
    const requestRuns = this.testRunRequests.get(data.request)
    if (requestRuns)
      requestRuns.splice(requestRuns.indexOf(run), 1)
    run.end()
  }

  public endTestRuns(request?: vscode.TestRunRequest) {
    if (request) {
      this.testRunRequests.get(request)?.forEach((run) => {
        const data = TestRunData.get(run)
        this.testRunsByFile.delete(data.file)
        run.end()
      })
      this.testRunRequests.delete(request)
      const files = getTestFiles(request.include || [])
      this.api.cancelRun(files, request.continuous)
    }
    else {
      this.testRunRequests.forEach((runs, request) => {
        const files = getTestFiles(request.include || [])
        this.api.cancelRun(files, request.continuous)
        runs.forEach((run) => {
          const data = TestRunData.get(run)
          this.testRunsByFile.delete(data.file)
          run.end()
        })
      })
      this.testRunRequests.clear()
    }
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

  private markResult(testRun: vscode.TestRun, test: vscode.TestItem, result?: TaskResult, task?: Task) {
    if (!result) {
      testRun.started(test)
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
          testRun.errored(test, errors, result.duration)
          return
        }
        const errors = result.errors?.map(err =>
          testMessageForTestError(test, err),
        ) || []
        testRun.failed(test, errors, result.duration)
        break
      }
      case 'pass':
        testRun.passed(test, result.duration)
        break
      case 'todo':
      case 'skip':
        testRun.skipped(test)
        break
      case 'only':
      case 'run':
        testRun.started(test)
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
