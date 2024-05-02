import path from 'node:path'
import { rm } from 'node:fs/promises'
import stripAnsi from 'strip-ansi'
import * as vscode from 'vscode'
import { getTasks } from '@vitest/ws-client'
import type { ErrorWithDiff, File, ParsedStack, Task, TaskResult } from 'vitest'
import { basename, normalize, relative } from 'pathe'
import { TestFile, TestFolder, getTestData } from '../testTreeData'
import type { TestTree } from '../testTree'
import type { VitestFolderAPI } from '../api'
import { log } from '../log'
import type { TestDebugManager } from '../debug/debugManager'
import { showVitestError } from '../utils'
import { coverageContext, readCoverageReport } from '../coverage'

export class TestRunner extends vscode.Disposable {
  private continuousRequests = new Set<vscode.TestRunRequest>()
  private simpleTestRunRequest: vscode.TestRunRequest | undefined

  private _onRequestsExhausted = new vscode.EventEmitter<void>()

  private testRun: vscode.TestRun | undefined
  private testRunDefer: PromiseWithResolvers<void> | undefined

  constructor(
    private readonly controller: vscode.TestController,
    private readonly tree: TestTree,
    private readonly api: VitestFolderAPI,
    private readonly debug: TestDebugManager,
  ) {
    super(() => {
      api.clearListeners()
      this.testRun?.end()
      this.testRun = undefined
      this.simpleTestRunRequest = undefined
      this.continuousRequests.clear()
      this.api.cancelRun()
      this._onRequestsExhausted.dispose()
    })

    api.onWatcherRerun((files, _trigger, collecting) => !collecting && this.startTestRun(files))

    api.onTaskUpdate((packs) => {
      packs.forEach(([testId, result]) => {
        const test = this.tree.getTestItemByTaskId(testId)
        if (!test) {
          log.error('Cannot find task during onTaskUpdate', testId)
          return
        }
        const testRun = this.testRun
        // there is no test run for collected tests
        if (!testRun)
          return

        this.markResult(testRun, test, result)
      })
    })

    api.onCollected((files, collecting) => {
      if (!files)
        return
      files.forEach(file => this.tree.collectFile(this.api, file))
      if (collecting)
        return

      getTasks(files).forEach((task) => {
        const test = this.tree.getTestItemByTask(task)
        if (!test) {
          log.error(`Test data not found for "${task.name}"`)
          return
        }
        const testRun = this.testRun
        if (!testRun)
          return
        if (task.mode === 'skip' || task.mode === 'todo')
          testRun.skipped(test)
        else
          this.markResult(testRun, test, task.result, task)
      })
    })

    api.onFinished(async (files = [], unhandledError, collecting) => {
      const testRun = this.testRun
      if (!testRun)
        return

      try {
        if (!collecting)
          await this.reportCoverage(files)
      }
      catch (err: any) {
        showVitestError(`Failed to report coverage. ${err.message}`, err)
      }

      files.forEach((file) => {
        const testItem = this.tree.getTestItemByTask(file)
        if (testItem)
          this.markResult(testRun, testItem, file.result, file)
      })

      if (unhandledError)
        testRun.appendOutput(formatTestOutput(unhandledError))

      this.endTestRun()
    })

    api.onConsoleLog(({ content, taskId }) => {
      const testItem = taskId ? tree.getTestItemByTaskId(taskId) : undefined
      const testRun = this.testRun
      if (testRun) {
        testRun.appendOutput(
          formatTestOutput(content),
          undefined,
          testItem,
        )
      }
      else {
        log.info('[TEST]', content)
      }
    })
  }

  public async debugTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    await this.debug.enable(this.api)

    const testItems = request.include?.length
      ? partitionTestFileItems(request.include)
      : this.tree.getAllFileItems().map(item => [item, []] as [vscode.TestItem, never[]])

    this.simpleTestRunRequest = request
    token.onCancellationRequested(() => {
      this.debug.disable(this.api)
      this.endTestRun()
      this.simpleTestRunRequest = undefined
      this.api.cancelRun()
      // just in case it gets stuck
      this.testRunDefer?.resolve()
    })

    // we need to run tests one file at a time, so we partition them
    // it's important to keep the same test items that were in the original request
    // because they dictate how format testNamePattern
    for (const [testFileData, testFileChildren] of testItems) {
      if (token.isCancellationRequested)
        break

      const includedTests = testFileChildren.length
        ? testFileChildren
        : [testFileData]

      await this.debug.startDebugging(
        () => this.runTestItems(request, includedTests).catch((err) => {
          log.error(err)
        }),
        () => this.api.cancelRun(),
        this.api.workspaceFolder,
      )
    }

    await this.debug.disable(this.api)

    this.simpleTestRunRequest = undefined
    this._onRequestsExhausted.fire()
  }

  private endTestRun() {
    this.testRun?.end()
    this.testRunDefer?.resolve()
    this.testRun = undefined
    this.testRunDefer = undefined
  }

  private async watchContinuousTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.continuousRequests.add(request)

    token.onCancellationRequested(() => {
      this.continuousRequests.delete(request)
      if (!this.continuousRequests.size) {
        this._onRequestsExhausted.fire()
        this.api.unwatchTests()
        this.endTestRun()
      }
    })

    if (!request.include?.length) {
      await this.api.watchTests()
    }
    else {
      const include = [...this.continuousRequests].map(r => r.include || []).flat()
      const files = getTestFiles(include)
      const testNamePatern = formatTestPattern(include)
      await this.api.watchTests(files, testNamePatern)
    }
  }

  public async runCoverage(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    try {
      await this.api.enableCoverage()
    }
    catch (err: any) {
      showVitestError(`Failed to enable coverage. ${err.message}`, err)
      return
    }

    const { dispose } = this._onRequestsExhausted.event(() => {
      if (!this.continuousRequests.size && !this.simpleTestRunRequest) {
        this.api.disableCoverage()
        dispose()
      }
    })

    token.onCancellationRequested(() => {
      this.api.disableCoverage()
    })

    await this.runTests(request, token)
  }

  public async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    // if request is continuous, we just mark it and wait for the changes to files
    // users can also click on "run" button to trigger the run
    if (request.continuous)
      return await this.watchContinuousTests(request, token)

    this.simpleTestRunRequest = request

    token.onCancellationRequested(() => {
      this.endTestRun()
      this.simpleTestRunRequest = undefined
      this.api.cancelRun()
    })

    await this.runTestItems(request, request.include || [])

    this.simpleTestRunRequest = undefined
    this._onRequestsExhausted.fire()
  }

  private async runTestItems(request: vscode.TestRunRequest, tests: readonly vscode.TestItem[]) {
    await this.testRunDefer?.promise

    this.testRunDefer = Promise.withResolvers()

    const runTests = (files?: string[], testNamePatern?: string) =>
      'updateSnapshots' in request
        ? this.api.updateSnapshots(files, testNamePatern)
        : this.api.runFiles(files, testNamePatern)

    const root = this.api.workspaceFolder.uri.fsPath
    if (!tests.length) {
      log.info(`Running all tests in ${basename(root)}`)
      await runTests()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      const files = getTestFiles(tests)
      if (testNamePatern)
        log.info(`Running ${files.length} file(s) with name pattern: ${testNamePatern}`)
      else
        log.info(`Running ${files.length} file(s):`, files.map(f => relative(root, f)))
      await runTests(files, testNamePatern)
    }
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

  private getTestFilesInFolder(path: string) {
    const folder = this.tree.getOrCreateFolderTestItem(this.api, path)
    const items = getFolderFiles(folder)
    return Array.from(
      new Set(items.map(item => (getTestData(item) as TestFile).filepath)),
    )
  }

  private createContinuousRequest() {
    if (!this.continuousRequests.size)
      return null
    const include = []
    let primaryRequest: vscode.TestRunRequest | null = null
    for (const request of this.continuousRequests) {
      if (!primaryRequest)
        primaryRequest = request
      include.push(...request.include || [])
    }
    return new vscode.TestRunRequest(
      include.length ? include : undefined,
      undefined,
      primaryRequest?.profile,
      true,
    )
  }

  private async startTestRun(files: string[], primaryRequest?: vscode.TestRunRequest) {
    const request = primaryRequest || this.simpleTestRunRequest || this.createContinuousRequest()

    if (!request)
      return

    if (this.testRun) {
      await this.testRunDefer?.promise
      this.endTestRun()
    }

    const name = files.length > 1
      ? undefined
      : relative(this.api.workspaceFolder.uri.fsPath, files[0])

    const run = this.testRun = this.controller.createTestRun(request, name)

    for (const file of files) {
      if (file[file.length - 1] === '/') {
        const files = this.getTestFilesInFolder(file)
        this.startTestRun(files, request)
        continue
      }

      // during test collection, we don't have test runs
      if (request.include && !this.isFileIncluded(file, request.include))
        continue

      const testItems = this.tree.getFileTestItems(file)
      function enqueue(test: vscode.TestItem) {
        run.enqueued(test)
        test.children.forEach(enqueue)
      }
      testItems.forEach(test => enqueue(test))
    }
  }

  public async reportCoverage(files: File[]) {
    if (!('FileCoverage' in vscode))
      return

    const reportsDirectory = await this.api.waitForCoverageReport()
    if (!reportsDirectory)
      return

    const coverage = readCoverageReport(reportsDirectory)

    const promises = files.map(async () => {
      const testRun = this.testRun
      if (testRun)
        await coverageContext.applyJson(testRun, coverage)
    })

    await Promise.all(promises)

    rm(reportsDirectory, { recursive: true, force: true }).catch(() => {
      // ignore
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

function getFolderFiles(folder: vscode.TestItem): vscode.TestItem[] {
  const files: vscode.TestItem[] = []
  for (const [_, item] of folder.children) {
    const data = getTestData(item)
    if (data instanceof TestFile)
      files.push(item)
    else if (data instanceof TestFolder)
      files.push(...getFolderFiles(item))
  }
  return files
}

function partitionTestFileItems(tests: readonly vscode.TestItem[]) {
  const fileItems = new Map<vscode.TestItem, vscode.TestItem[]>()

  for (const testItem of tests) {
    const data = getTestData(testItem)
    if (data instanceof TestFile) {
      const items = fileItems.get(testItem) || []
      fileItems.set(testItem, items)
      continue
    }
    if (data instanceof TestFolder) {
      const items = getFolderFiles(testItem)
      items.forEach((item) => {
        const fileItemsForFile = fileItems.get(item) || []
        fileItems.set(item, fileItemsForFile)
      })
      continue
    }
    const fileTestItem = getTestItemFile(testItem)
    if (!fileTestItem) {
      log.error('Cannot find the file test item for', testItem.label)
      continue
    }
    const items = fileItems.get(fileTestItem) || []
    fileItems.set(fileTestItem, items)
    items.push(testItem)
  }

  return Array.from(fileItems.entries())
}

function getTestItemFile(testItem: vscode.TestItem): vscode.TestItem | null {
  let parent = testItem.parent
  while (parent) {
    const data = getTestData(parent)
    if (data instanceof TestFile)
      return parent
    parent = parent.parent
  }
  return null
}

function getTestFiles(tests: readonly vscode.TestItem[]) {
  return Array.from(
    new Set(tests.map((test) => {
      const data = getTestData(test)
      const fsPath = normalize(test.uri!.fsPath)
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

function formatTestOutput(output: string) {
  return output.replace(/(?<!\r)\n/g, '\r\n')
}
