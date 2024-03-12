import path from 'node:path'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, ParsedStack, Task, TaskResult } from 'vitest'
import type { VitestAPI, VitestFolderAPI } from '../api'
import type { TestData } from '../testTreeData'
import { TestFolder, getTestData } from '../testTreeData'
import { log } from '../log'
import type { DebugSessionAPI } from '../debug/startSession'
import { startDebugSession } from '../debug/startSession'
import type { TestTree } from '../testTree'

function formatTestPattern(tests: readonly vscode.TestItem[]) {
  if (tests.length !== 1)
    return
  const data = getTestData(tests[0])!
  if (!('getTestNamePattern' in data))
    return
  return data.getTestNamePattern()
}

export class FolderTestRunner extends vscode.Disposable {
  private testRun?: vscode.TestRun

  private taskIdToTestData = new Map<string, TestData>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly runner: GlobalTestRunner,
    private readonly tree: TestTree,
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
      files.forEach((file) => {
        const fileTestItem = this.tree.getOrCreateFileTestItem(file.filepath)
        fileTestItem.children.replace([])
        this.tree.flatTestItems.set(file.id, fileTestItem)
        this.tree.collectTasks(file.tasks, fileTestItem)
      })
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

      this.endTestRun()
    })

    api.onConsoleLog(({ content, taskId }) => {
      const data = taskId ? runner.getTestDataByTaskId(taskId) : undefined
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

  public endTestRun() {
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

export class GlobalTestRunner extends vscode.Disposable {
  public currentVscodeRequest?: vscode.TestRunRequest

  private runners: FolderTestRunner[] = []

  private debug?: DebugSessionAPI

  constructor(
    private readonly api: VitestAPI,
    private readonly tree: TestTree,
    private readonly controller: vscode.TestController,
  ) {
    super(() => {
      this.runners.forEach(runner => runner.dispose())
      this.runners = []
    })

    api.forEach((folderAPI) => {
      this.runners.push(new FolderTestRunner(this.controller, this, tree, folderAPI))
    })
  }

  public getTestDataByTaskId(taskId: string): TestData | null {
    const testItem = this.tree.flatTestItems.get(taskId)
    if (!testItem)
      return null
    return getTestData(testItem) || null
  }

  public getTestDataByTask(task: Task): TestData | null {
    const cachedItem = this.tree.flatTestItems.get(task.id)
    if (cachedItem)
      return getTestData(cachedItem) || null
    if ('filepath' in task && task.filepath) {
      const testItem = this.tree.fileItems.get(task.filepath)
      return testItem ? getTestData(testItem) || null : null
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

  public endTestRuns() {
    this.runners.forEach(runner => runner.endTestRun())
  }

  public async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.currentVscodeRequest = request
    token.onCancellationRequested(() => {
      this.api.cancelRun()
      this.currentVscodeRequest = undefined
      this.endTestRuns()
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
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(test.uri!)
        if (!workspaceFolder) {
          log.error('Workspace folder not found for', test.uri?.fsPath)
          return
        }
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
      new Set(tests.map((test) => {
        const data = getTestData(test)
        const fsPath = test.uri!.fsPath
        if (data instanceof TestFolder)
          return `${fsPath}/`
        return fsPath
      }).filter(Boolean) as string[]),
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
