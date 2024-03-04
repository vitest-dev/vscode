import path from 'node:path'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, ParsedStack, Task, TaskResult } from 'vitest'
import type { VitestAPI, VitestFolderAPI } from '../api'
import type { TestData } from '../TestData'
import { TestFile, WEAKMAP_TEST_DATA, getTestItemFolder } from '../TestData'
import { log } from '../log'
import type { DebugSessionAPI } from '../debug/startSession'
import { startDebugSession } from '../debug/startSession'

function getFilepathFromTask(task: Task) {
  if ('filepath' in task)
    return task.filepath
  return task.file?.filepath
}

function formatTestPattern(tests: readonly vscode.TestItem[]) {
  if (!tests.length || tests.length > 1)
    return
  const data = WEAKMAP_TEST_DATA.get(tests[0])!
  if (!data.nameResolver)
    return
  return data.nameResolver.asVitestArgs()
}

export class FolderTestRunner extends vscode.Disposable {
  private testRun?: vscode.TestRun

  private taskIdToTestData = new Map<string, TestData>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly runner: GlobalTestRunner,
    api: VitestFolderAPI,
  ) {
    super(() => {
      api.clearListeners()
      this.taskIdToTestData.clear()
    })

    api.onWatcherRerun(() => this.startTestRun())

    api.onTaskUpdate((packs) => {
      packs.forEach(([testId, result]) => {
        const test = this.runner.getTestDataByTaskId(testId)
        if (!test)
          return
        this.markResult(test.item, result)
      })
    })

    api.onCollected((files) => {
      const run = this.testRun
      if (!files || !run)
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

      this.endTestRun()
    })

    api.onConsoleLog(({ content, taskId }) => {
      const data = taskId ? runner.getTestDataByTaskId(taskId) : undefined
      this.testRun?.appendOutput(
        content.replace(/(?<!\r)\n/g, '\r\n'),
        undefined,
        data?.item,
      )
    })
  }

  private startTestRun() {
    const currentRequest = this.runner.currentVscodeRequest
    if (currentRequest) {
      // report only if continuous mode is enabled or this is the first run
      if (!this.testRun || currentRequest.continuous) {
        const name = currentRequest.include?.length ? undefined : 'Running all tests'
        this.testRun = this.controller.createTestRun(currentRequest, name)
      }
    }
  }

  private endTestRun() {
    this.testRun?.end()
    this.testRun = undefined
  }

  private forEachTask(tasks: Task[], fn: (task: Task, test: TestData) => void) {
    getTasks(tasks).forEach((task) => {
      const test = this.runner.getTestDataByTask(task)
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
          this.testRun.failed(test, errors, result.duration)
          return
        }
        const errors = result.errors?.map(err =>
          testMessageForTestError(test, err),
        ) || []
        this.testRun.errored(test, errors, result.duration)
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

function unwrapTask(task: Task, path: Task[] = []) {
  path.push(task)
  if (task.suite)
    unwrapTask(task.suite, path)
  return path
}

function findTestItemByTaskPath(path: Task[], filepath: string, item: vscode.TestItem, depth = 0): TestData | null {
  const data = WEAKMAP_TEST_DATA.get(item)!
  const isFile = depth === 0 && data instanceof TestFile && filepath === data.getFilePath()
  // the names are the same or the name matches the regexp (when "each")
  // TODO: in the future, collect files with Vitest API instead
  if (isFile || item.label === path[depth].name || (!(data instanceof TestFile) && data.nameResolver.start.isEach && data.nameResolver.regexp.test(path[depth].name))) {
    if (path.length === depth + 1)
      return data

    for (const [_, child] of item.children) {
      const found = findTestItemByTaskPath(path, filepath, child, depth + 1)
      if (found)
        return found
    }
  }
  return null
}

export class GlobalTestRunner extends vscode.Disposable {
  public currentVscodeRequest?: vscode.TestRunRequest

  private taskIdToTestData = new Map<string, TestData>()
  private runners: FolderTestRunner[] = []

  private debug?: DebugSessionAPI

  constructor(
    private readonly api: VitestAPI,
    private readonly controller: vscode.TestController,
  ) {
    super(() => {
      this.taskIdToTestData.clear()
      this.runners.forEach(runner => runner.dispose())
    })

    api.forEach((folderAPI) => {
      this.runners.push(new FolderTestRunner(this.controller, this, folderAPI))
    })
  }

  public getTestDataByTaskId(taskId: string): TestData | null {
    return this.taskIdToTestData.get(taskId) ?? null
  }

  public getTestDataByTask(task: Task): TestData | null {
    const cached = this.taskIdToTestData.get(task.id)
    if (cached)
      return cached
    const filepath = getFilepathFromTask(task)
    if (!filepath)
      return null
    const fileUrl = vscode.Uri.file(filepath).toString()
    const fileItem = this.controller.items.get(fileUrl)
    if (!fileItem)
      return null
    const path = unwrapTask(task).reverse()
    const found = findTestItemByTaskPath(path, filepath, fileItem)
    if (found) {
      this.taskIdToTestData.set(task.id, found)
      return found
    }
    return null
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
    this.currentVscodeRequest = request
    token.onCancellationRequested(() => {
      // TODO: test how tests are marked since Vitest by default changes the stateMap
      this.api.cancelRun()
      this.currentVscodeRequest = undefined
    })

    const tests = request.include ?? []

    if (!tests.length) {
      await this.api.runFiles()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      // run only affected folders
      const workspaces = new Map<vscode.WorkspaceFolder, vscode.TestItem[]>()
      tests.forEach((test) => {
        const workspaceFolder = getTestItemFolder(test)
        const folderTests = workspaces.get(workspaceFolder) ?? []
        folderTests.push(test)
        workspaces.set(workspaceFolder, folderTests)
      })
      for (const [folder, tests] of workspaces.entries()) {
        const folderAPI = this.api.get(folder)
        const files = this.getTestFiles(tests)
        await folderAPI.runFiles(files, testNamePatern)
      }
    }

    if (!request.continuous)
      this.currentVscodeRequest = undefined
  }

  private getTestFiles(tests: readonly vscode.TestItem[]) {
    return Array.from(
      new Set(tests.map(test => test.uri?.fsPath).filter(Boolean) as string[]),
    )
  }
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
