import type { ParsedStack, RunnerTaskResult, TestError } from 'vitest'
import type { ExtensionTestSpecification } from 'vitest-vscode-shared'
import type { RunHandle, VitestProcessAPI } from './apiProcess'
import type { ExtensionDiagnostic } from './diagnostic'
import type { ImportsBreakdownProvider } from './importsBreakdownProvider'
import type { InlineConsoleLogManager } from './inlineConsoleLog'
import type { TestTree } from './testTree'
import crypto from 'node:crypto'
import path from 'node:path'
import { getTasks } from '@vitest/runner/utils'
import { basename, normalize, relative } from 'pathe'
import { normalizeDriveLetter } from 'vitest-vscode-shared'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { coverageContext } from './coverage'
import { log } from './log'
import { getTestData, TestCase, TestFile, TestFolder } from './testTreeData'
import { getErrorMessage, showVitestError } from './utils'

export class TestRunner extends vscode.Disposable {
  protected testRun: vscode.TestRun | undefined
  // The request tied to the testRun
  protected testRunRequest: vscode.TestRunRequest | undefined

  protected disposables: vscode.Disposable[] = []

  constructor(
    protected readonly handle: RunHandle,
    protected readonly controller: vscode.TestController,
    protected readonly tree: TestTree,
    protected readonly api: VitestProcessAPI,
    protected readonly diagnostic: ExtensionDiagnostic | undefined,
    protected readonly importsBreakdown: ImportsBreakdownProvider,
    protected readonly inlineConsoleLog: InlineConsoleLogManager,
  ) {
    super(() => {
      log.verbose?.('Disposing test runner')
      this.endTestRun()
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
      log.offWorkerLog(this.onWorkerLog)
    })

    log.onWorkerLog(this.onWorkerLog)

    handle.handlers.onTestRunStart((files) => {
      if (!files.length)
        return

      files.forEach((file) => {
        const uri = vscode.Uri.file(file)
        this.diagnostic?.deleteDiagnostic(uri)
      })
      this.inlineConsoleLog.clear()
    })

    handle.handlers.onTaskUpdate((packs) => {
      packs.forEach(([testId, result]) => {
        const test = this.tree.getTestItemByTaskId(testId)
        if (!test) {
          log.error('Cannot find task during onTaskUpdate', testId)
          return
        }
        const testRun = this.testRun
        // there is no test run for collected tests
        if (!testRun) {
          log.verbose?.(`There is no test run for "${test.label}"`)
          return
        }
        this.markResult(testRun, test, result)
      })
    })

    handle.handlers.onCollected((file, collecting) => {
      this.tree.collectFile(this.api, file)
      if (collecting)
        return

      this.importsBreakdown.refreshCurrentDecorations()

      getTasks(file).forEach((task) => {
        const test = this.tree.getTestItemByTask(task)
        if (!test) {
          log.error(`Test data not found for "${task.name}"`)
          return
        }
        const testRun = this.testRun
        if (!testRun)
          return

        if (task.mode === 'skip' || task.mode === 'todo') {
          const include = this.testRunRequest?.include
          if (this.testRunRequest && (!include || this.isTestIncluded(test, include))) {
            log.verbose?.(`Marking "${test.label}" as skipped`)
            testRun.skipped(test)
          }
          else {
            log.verbose?.(`Ignore "${test.label}" during collection`)
          }
        }
        else if (!task.result && task.type !== 'suite') {
          log.verbose?.(`Enqueuing "${test.label}" because it was just collected`)
          testRun.enqueued(test)
        }
        else {
          this.markResult(testRun, test, task.result)
        }
      })
    })

    handle.handlers.onTestRunEnd(async (files, unhandledError, collecting, coverage) => {
      const testRun = this.testRun

      if (!testRun) {
        if (unhandledError)
          log.error(unhandledError)
        this.endTestRun()
        return
      }

      if (coverage) {
        await this.reportCoverage(coverage).catch((err) => {
          showVitestError(`Failed to report coverage. ${err.message}`, err)
        })
      }

      if (unhandledError)
        testRun.appendOutput(formatTestOutput(unhandledError))

      if (!collecting)
        this.endTestRun()
    })

    handle.handlers.onConsoleLog((consoleLog) => {
      this.inlineConsoleLog.addConsoleLog(consoleLog)
    })
  }

  private onWorkerLog = (message: string) => {
    if (this.testRun) {
      this.testRun.appendOutput(formatTestOutput(message))
    }
    else if (message) {
      // So we don't lose the log. Ideally, we should start runner sooner
      log.verbose?.('[WORKER]', message)
    }
  }

  protected endTestRun() {
    if (this.testRun) {
      log.verbose?.('Ending test run', this.testRun.name || '')
      this.testRun?.end()
      this.testRun = undefined
    }
    this.testRunRequest = undefined
  }

  private triggerCancel(request?: vscode.TestRunRequest) {
    const timeout = getConfig(this.api.workspaceFolder).forceCancelTimeout
    const timeoutId = setTimeout(() => {
      this.api.cancelRun()
      log.error(`Triggering a force cancel timeout (${timeout}ms).`)
    }, timeout)

    this.api.cancelRun().then(() => {
      clearTimeout(timeoutId)
      this.endTestRun()
    })

    log.verbose?.('Test run was cancelled manually for', labelTestItems(request?.include))
  }

  public async runTests(request: vscode.TestRunRequest) {
    const tests = request.include || []
    const files = getTestFiles(tests)

    const testFiles = files.filter(f => !(typeof f === 'string' ? f : f[1]).endsWith('/'))
    const testRunName = testFiles.length === 1
      ? this.relative(testFiles[0])
      : undefined
    const run = this.testRun = this.createCancellableTestRun(request, testRunName)
    this.testRunRequest = request

    const testItems = request.include || this.controller.items
    function enqueue(test: vscode.TestItem) {
      const testData = getTestData(test)
      // we only change the state of test cases to keep the correct test count
      if (testData instanceof TestCase && !testData.dynamic) {
        log.verbose?.(`Enqueuing "${test.label}"`)
        run.enqueued(test)
      }
      test.children.forEach(enqueue)
    }
    testItems.forEach(test => enqueue(test))

    const runTests = (files?: ExtensionTestSpecification[] | string[], testNamePatern?: string) =>
      'updateSnapshots' in request
        ? this.handle.rpc.updateSnapshots(files, testNamePatern)
        : this.handle.rpc.runTests(files, testNamePatern)

    if (!tests.length) {
      const root = this.api.workspaceFolder.uri.fsPath
      log.info(`Running all tests in ${basename(root)}`)
      await runTests()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      if (testNamePatern)
        log.info(`Running ${files.length} file(s) with name pattern: ${testNamePatern}`)
      else
        log.info(`Running ${files.length} file(s):`, files.map(f => this.relative(f)))
      await runTests(files, testNamePatern)
    }
  }

  private isTestIncluded(test: vscode.TestItem, include: readonly vscode.TestItem[] | vscode.TestItemCollection) {
    for (const _item of include) {
      const item = 'id' in _item ? _item : _item[1]
      if (item === test)
        return true
      if (this.isTestIncluded(test, item.children))
        return true
    }
    return false
  }

  protected createCancellableTestRun(request: vscode.TestRunRequest, name?: string) {
    const run = this.testRun = this.controller.createTestRun(request, name)

    run.token.onCancellationRequested(() => {
      this.triggerCancel(this.testRunRequest)
    })

    return run
  }

  public async reportCoverage(coverage: any) {
    const testRun = this.testRun
    if (!testRun)
      return

    // TODO: quick patch, coverage shouldn't report negative columns
    function ensureLoc(loc: any) {
      if (!loc)
        return
      if (loc.start?.column && loc.start.column < 0)
        loc.start.column = 0
      if (loc.end?.column && loc.end.column < 0)
        loc.end.column = 0
    }
    for (const file in coverage) {
      coverage[file] = coverage[file].data

      const fileCoverage = coverage[file]
      for (const key in fileCoverage.branchMap) {
        const branch = fileCoverage.branchMap[key]
        ensureLoc(branch.loc)
        branch.locations?.forEach((loc: any) => ensureLoc(loc))
      }
    }

    await coverageContext.applyJson(testRun, coverage)
  }

  private markTestCase(
    testRun: vscode.TestRun,
    test: vscode.TestItem,
    result: RunnerTaskResult,
  ) {
    setTestErrors(test, result.errors as TestError[])

    switch (result.state) {
      case 'fail': {
        const errors = result.errors?.map(err =>
          testMessageForTestError(test, err as TestError),
        ) || []
        if (!errors.length) {
          log.verbose?.(`Test failed, but no errors found for "${test.label}"`)
          return
        }
        if (test.uri)
          this.diagnostic?.addDiagnostic(test.uri, errors)
        log.verbose?.(`Marking "${test.label}" as failed with ${errors.length} errors`)
        testRun.failed(test, errors, result.duration)
        break
      }
      case 'pass':
        log.verbose?.(`Marking "${test.label}" as passed`)
        testRun.passed(test, result.duration)
        break
      case 'todo':
      case 'skip':
        log.verbose?.(`Marking "${test.label}" as skipped`)
        testRun.skipped(test)
        break
      case 'only':
      case 'run':
      case 'queued':
        log.verbose?.(`Marking "${test.label}" as running (state is ${result.state})`)
        testRun.started(test)
        break
      default: {
        const _never: never = result.state
        log.error('Unknown test result for', `${test.label}: ${result.state}`)
      }
    }
  }

  // we only change the state of test cases to keep the correct test count
  // ignoring test files, test folders and suites - these only report syntax errors
  private markNonTestCase(test: vscode.TestItem, result?: RunnerTaskResult) {
    if (!result) {
      log.verbose?.(`No task result for "${test.label}", ignoring`)
      return
    }

    // errors in a suite are stored only if it happens during discovery
    const errors = result.errors?.map(err =>
      err.stack || err.message,
    )
    if (!errors?.length) {
      log.verbose?.(`No errors found for "${test.label}"`)
      return
    }
    log.verbose?.(`Marking "${test.label}" as failed with ${errors.length} errors`)
    test.error = errors.join('\n')
  }

  private markResult(testRun: vscode.TestRun, test: vscode.TestItem, result?: RunnerTaskResult) {
    const isTestCase = getTestData(test) instanceof TestCase

    if (!isTestCase) {
      this.markNonTestCase(test, result)
      return
    }

    if (!result) {
      log.verbose?.(`No task result for "${test.label}", assuming the test just started running`)
      testRun.started(test)
      return
    }

    this.markTestCase(testRun, test, result)
  }

  protected relative(file: string | ExtensionTestSpecification) {
    return relative(this.api.workspaceFolder.uri.fsPath, typeof file === 'string' ? file : file[1])
  }
}

export class ContinuousTestRunner extends TestRunner {
  constructor(
    handle: RunHandle,
    controller: vscode.TestController,
    tree: TestTree,
    api: VitestProcessAPI,
    diagnostic: ExtensionDiagnostic | undefined,
    importsBreakdown: ImportsBreakdownProvider,
    inlineConsoleLog: InlineConsoleLogManager,
    private readonly testRunProfile: vscode.TestRunProfile,
    private readonly continuousRequests: Set<vscode.TestRunRequest>,
  ) {
    super(handle, controller, tree, api, diagnostic, importsBreakdown, inlineConsoleLog)
    handle.handlers.onTestRunStart((files) => {
      this.startTestRun(files)
      log.verbose?.('Starting a test run because', ...files.map(f => this.relative(f)), 'triggered a watch rerun event')
    })
  }

  public async syncWatcher() {
    if (!this.continuousRequests.size) {
      return
    }

    const include = [...this.continuousRequests].map(r => r.include || []).flat()

    if (!include.length) {
      await this.handle.rpc.watchTests()
      log.info('[RUNNER]', 'Watching all test files')
    }
    else {
      const files = getTestFiles(include)
      const testNamePatern = formatTestPattern(include)
      await this.handle.rpc.watchTests(files, testNamePatern)
      log.info(
        '[RUNNER]',
        'Watching test files:',
        files.map(f => this.relative(f)).join(', '),
        testNamePatern ? `with pattern ${testNamePatern}` : '',
      )
    }
  }

  private async startTestRun(files: string[], request = this.createContinuousRequest()) {
    if (this.testRun) {
      return
    }

    if (!files.length) {
      log.verbose?.('Started an empty test run. This should not happen...')
      return
    }

    if (!request) {
      log.verbose?.('No test run request found for', ...files.map(f => this.relative(f)))
      return
    }

    const name = files.length > 1
      ? undefined
      : this.relative(files[0])

    this.testRunRequest = request
    const run = this.createCancellableTestRun(request, name)

    for (const file of files) {
      if (file[file.length - 1] === '/') {
        const files = this.getTestFilesInFolder(file)
        this.startTestRun(files, request)
        continue
      }

      // during test collection, we don't have test runs
      if (request.include && !this.isFileIncluded(file, request.include))
        continue

      const testItems = request.include || this.tree.getFileTestItems(file)
      function enqueue(test: vscode.TestItem) {
        const testData = getTestData(test)
        // we only change the state of test cases to keep the correct test count
        if (testData instanceof TestCase && !testData.dynamic && files.includes(testData.file.filepath)) {
          log.verbose?.(`Enqueuing "${test.label}"`)
          run.enqueued(test)
        }
        if (testData instanceof TestFile) {
          // ignore tests in another files, this is relevant for continuous runs
          if (!files.includes(testData.filepath)) {
            return
          }
        }
        test.children.forEach(enqueue)
      }
      testItems.forEach(test => enqueue(test))
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
    const items = this.tree.getFolderFiles(folder)
    return Array.from(
      new Set(items.map(item => (getTestData(item) as TestFile).filepath)),
    )
  }

  // It is important to create new requests every time the file is changed,
  // Otherwise it becomes stale.
  private createContinuousRequest() {
    if (!this.continuousRequests.size)
      return undefined
    const include = []
    for (const request of this.continuousRequests) {
      include.push(...request.include || [])
    }
    return new vscode.TestRunRequest(
      include.length ? include : undefined,
      undefined,
      this.testRunProfile,
      true,
    )
  }
}

function setTestErrors(test: vscode.TestItem, errors: TestError[] | undefined) {
  const data = getTestData(test)
  if (data instanceof TestCase) {
    data.setErrors(errors)
  }
}

function testMessageForTestError(testItem: vscode.TestItem, error: TestError | undefined): vscode.TestMessage {
  if (!error)
    return new vscode.TestMessage('Unknown error')

  let testMessage
  if (error.actual != null && error.expected != null && error.actual !== 'undefined' && error.expected !== 'undefined')
    testMessage = vscode.TestMessage.diff(getErrorMessage(error), error.expected, error.actual)
  else
    testMessage = new vscode.TestMessage(getErrorMessage(error))

  setMessageStackFramesFromErrorStacks(testMessage, error.stacks)

  const location = parseLocationFromStacks(testItem, error.stacks ?? [])
  if (location) {
    const position = new vscode.Position(location.line - 1, location.column - 1)
    testMessage.location = new vscode.Location(vscode.Uri.file(location.path), position)
  }
  const errorId = crypto.randomUUID()
  error.__vscode_id = errorId
  testMessage.contextValue = errorId
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
    const sourceNormalizedPath = sourceFilepath && normalizeDriveLetter(sourceFilepath)
    if (sourceNormalizedPath !== targetFilepath || Number.isNaN(column) || Number.isNaN(line))
      continue

    return {
      path: sourceNormalizedPath,
      line,
      column,
    }
  }

  log.verbose?.('Could not find a valid stack for', testItem.label, JSON.stringify(stacks, null, 2))
}

function setMessageStackFramesFromErrorStacks(testMessage: vscode.TestMessage, stacks: ParsedStack[] | undefined) {
  // Error stack frames are available only in ^1.93
  if (!('TestMessageStackFrame' in vscode))
    return
  if (!stacks || stacks.length === 0)
    return

  const TestMessageStackFrame = vscode.TestMessageStackFrame

  const frames = stacks.map((stack) => {
    const { sourceFilepath, line, column } = getSourceFilepathAndLocationFromStack(stack)
    const sourceUri = sourceFilepath ? vscode.Uri.file(sourceFilepath) : undefined
    return new TestMessageStackFrame(stack.method, sourceUri, new vscode.Position(line - 1, column - 1))
  })

  testMessage.stackTrace = frames
}

function getTestFiles(tests: readonly vscode.TestItem[]): string[] | ExtensionTestSpecification[] {
  // if there is a folder, we can't limit the tests to a specific project
  const hasFolder = tests.some(test => getTestData(test) instanceof TestFolder)
  if (hasFolder) {
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
  const testSpecs: ExtensionTestSpecification[] = []
  const testFiles = new Set<string>()
  for (const test of tests) {
    const fsPath = test.uri!.fsPath
    const data = getTestData(test)
    // just to type guard, actually not possible to have
    if (data instanceof TestFolder)
      continue
    const project = data instanceof TestFile ? data.project : data.file.project
    const key = `${project}\0${fsPath}`
    if (testFiles.has(key))
      continue
    testFiles.add(key)
    testSpecs.push([project, fsPath])
  }
  return testSpecs
}

function formatTestPattern(tests: readonly vscode.TestItem[], patterns: string[] = []) {
  for (const test of tests) {
    const data = getTestData(test)!
    // file or a folder, try to include every test in there
    if (!('getTestNamePattern' in data)) {
      formatTestPattern([...test.children].map(t => t[1]), patterns)
      continue
    }
    patterns.push(data.getTestNamePattern())
  }
  if (!patterns.length)
    return undefined
  return patterns.join('|')
}

function formatTestOutput(output: string) {
  return output.replace(/(?<!\r)\n/g, '\r\n')
}

function labelTestItems(items: readonly vscode.TestItem[] | undefined) {
  if (!items)
    return '<all tests>'
  return items.map(p => `"${p.label}"`).join(', ')
}
