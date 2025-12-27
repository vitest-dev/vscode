import type { ParsedStack, RunnerTaskResult, TestError } from 'vitest'
import type { ExtensionTestSpecification } from 'vitest-vscode-shared'
import type { VitestFolderAPI } from './api'
import type { ExtensionDiagnostic } from './diagnostic'
import type { ImportsBreakdownProvider } from './importsBreakdownProvider'
import type { TestTree } from './testTree'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { inspect, stripVTControlCharacters } from 'node:util'
import { getTasks } from '@vitest/runner/utils'
import { basename, normalize, relative } from 'pathe'
import { normalizeDriveLetter } from 'vitest-vscode-shared'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { coverageContext, readCoverageReport } from './coverage'
import { log } from './log'
import { getTestData, TestCase, TestFile, TestFolder } from './testTreeData'
import { showVitestError } from './utils'

export class TestRunner extends vscode.Disposable {
  private continuousRequests = new Set<vscode.TestRunRequest>()
  private nonContinuousRequest: vscode.TestRunRequest | undefined

  private _onRequestsExhausted = new vscode.EventEmitter<void>()

  private testRun: vscode.TestRun | undefined
  private testRunDefer: PromiseWithResolvers<void> | undefined
  private testRunRequest: vscode.TestRunRequest | undefined

  private disposables: vscode.Disposable[] = []

  private cancelled = false

  private showInlineConsoleLog = true

  constructor(
    private readonly controller: vscode.TestController,
    private readonly tree: TestTree,
    private readonly api: VitestFolderAPI,
    private readonly diagnostic: ExtensionDiagnostic | undefined,
    private readonly importsBreakdown: ImportsBreakdownProvider,
  ) {
    super(() => {
      log.verbose?.('Disposing test runner')
      api.clearListeners()
      this.endTestRun()
      this.nonContinuousRequest = undefined
      this.continuousRequests.clear()
      this.api.cancelRun()
      this._onRequestsExhausted.dispose()
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
    })

    // Initialize with workspace-specific config
    this.showInlineConsoleLog = getConfig(api.workspaceFolder).showInlineConsoleLog

    api.onStdout((content) => {
      if (this.testRun) {
        this.testRun.appendOutput(formatTestOutput(content))
      }
    })

    api.onTestRunStart((files, collecting) => {
      if (!files.length) {
        return
      }

      if (collecting) {
        log.verbose?.('Not starting the runner because tests are being collected for', ...files.map(f => this.relative(f)))
      }
      else {
        files.forEach((file) => {
          const uri = vscode.Uri.file(file)
          this.diagnostic?.deleteDiagnostic(uri)
        })
        log.verbose?.('Starting a test run because', ...files.map(f => this.relative(f)), 'triggered a watch rerun event')
        this.startTestRun(files)
      }
    })

    api.onTaskUpdate((packs) => {
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

    api.onCollected((file, collecting) => {
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
        if (!testRun) {
          return
        }

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

    api.onTestRunEnd(async (files, unhandledError, collecting) => {
      const testRun = this.testRun

      if (!testRun) {
        log.verbose?.('No test run to finish for', files.map(f => this.relative(f.filepath)).join(', '))
        if (!files.length) {
          log.verbose?.('No files to finish')
        }
        if (unhandledError) {
          log.error(unhandledError)
        }
        return
      }

      try {
        if (!collecting)
          await this.reportCoverage()
      }
      catch (err: any) {
        showVitestError(`Failed to report coverage. ${err.message}`, err)
      }

      if (unhandledError)
        testRun.appendOutput(formatTestOutput(unhandledError))

      if (!collecting)
        this.endTestRun()
    })

    api.onConsoleLog((consoleLog) => {
      const testItem = consoleLog.taskId ? tree.getTestItemByTaskId(consoleLog.taskId) : undefined
      const testRun = this.testRun
      if (testRun) {
        // Create location from parsed console log for inline display
        // Only set location if inline console logs are enabled
        let location: vscode.Location | undefined
        if (consoleLog.parsedLocation && this.showInlineConsoleLog) {
          const uri = vscode.Uri.file(consoleLog.parsedLocation.file)
          const position = new vscode.Position(
            consoleLog.parsedLocation.line,
            consoleLog.parsedLocation.column,
          )
          location = new vscode.Location(uri, position)
        }

        testRun.appendOutput(
          formatTestOutput(consoleLog.content) + (consoleLog.browser ? '\r\n' : ''),
          location,
          testItem,
        )
      }
      else {
        log.info('[TEST]', consoleLog.content)
      }
    })

    // Listen to configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest.showInlineConsoleLog', api.workspaceFolder.uri)) {
          this.showInlineConsoleLog = getConfig(api.workspaceFolder).showInlineConsoleLog
        }
      }),
    )
  }

  protected endTestRun() {
    log.verbose?.('Ending test run', this.testRun ? this.testRun.name || '' : '<none>')
    this.testRun?.end()
    this.testRunDefer?.resolve()
    this.testRun = undefined
    this.testRunDefer = undefined
    this.testRunRequest = undefined
  }

  private async watchContinuousTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.continuousRequests.add(request)

    this.disposables.push(
      token.onCancellationRequested(() => {
        log.verbose?.('Continuous test run for', labelTestItems(request.include), 'was cancelled')

        this.continuousRequests.delete(request)
        if (!this.continuousRequests.size) {
          log.verbose?.('Stopped watching test files')
          this._onRequestsExhausted.fire()
          this.api.unwatchTests()
          this.endTestRun()
        }
      }),
    )

    if (!request.include?.length) {
      log.info('[RUNNER]', 'Watching all test files')
      await this.api.watchTests()
    }
    else {
      const include = [...this.continuousRequests].map(r => r.include || []).flat()
      const files = getTestFiles(include)
      const testNamePatern = formatTestPattern(include)
      log.info(
        '[RUNNER]',
        'Watching test files:',
        files.map(f => this.relative(f)).join(', '),
        testNamePatern ? `with pattern ${testNamePatern}` : '',
      )
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
      if (!this.continuousRequests.size && !this.nonContinuousRequest) {
        log.verbose?.('Coverage was disabled due to all requests being exhausted')
        this.api.disableCoverage()
        dispose()
      }
    })

    this.disposables.push(
      token.onCancellationRequested(() => {
        log.verbose?.('Coverage for', labelTestItems(request.include), 'was manually stopped')
        this.api.disableCoverage()
      }),
    )

    const modules = !request.include
      ? null
      : getTestFiles(request.include).map((f) => {
          if (typeof f === 'string') {
            return f
          }
          return f[1]
        })

    await this.api.invalidateIstanbulTestModules(modules)
    await this.runTests(request, token)
  }

  public async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    // if request is continuous, we just mark it and wait for the changes to files
    // users can also click on "run" button to trigger the run
    if (request.continuous)
      return await this.watchContinuousTests(request, token)

    try {
      await this.scheduleTestItems(request, token)
    }
    catch (err: any) {
      // the rpc can be closed during the test run by clicking on reload
      if (!err.message.startsWith('[birpc] rpc is closed')) {
        log.error('Failed to run tests', err)
      }
      this.endTestRun()
    }
  }

  protected scheduleTestRunsQueue: {
    runTests: () => Promise<void>
    resolveWithoutRunning: () => void
  }[] = []

  private async runTestItems(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.cancelled = false
    this.nonContinuousRequest = request

    this.disposables.push(
      token.onCancellationRequested(() => {
        if (request === this.nonContinuousRequest) {
          this.cancelled = true
          this.api.cancelRun().then(() => {
            this.nonContinuousRequest = undefined
            this.endTestRun()
          })
          log.verbose?.('Test run was cancelled manually for', labelTestItems(request.include))
        }
      }),
    )

    const runTests = (files?: ExtensionTestSpecification[] | string[], testNamePatern?: string) =>
      'updateSnapshots' in request
        ? this.api.updateSnapshots(files, testNamePatern)
        : this.api.runFiles(files, testNamePatern)

    const tests = request.include || []
    if (!tests.length) {
      const root = this.api.workspaceFolder.uri.fsPath
      log.info(`Running all tests in ${basename(root)}`)
      await runTests()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      const files = getTestFiles(tests)
      if (testNamePatern)
        log.info(`Running ${files.length} file(s) with name pattern: ${testNamePatern}`)
      else
        log.info(`Running ${files.length} file(s):`, files.map(f => this.relative(f)))
      await runTests(files, testNamePatern)
    }

    if (request === this.nonContinuousRequest) {
      this.nonContinuousRequest = undefined
      this._onRequestsExhausted.fire()
    }
  }

  protected async scheduleTestItems(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    if (!this.testRunDefer) {
      await this.runTestItems(request, token)
    }
    else {
      log.verbose?.('Queueing a new test run to execute when the current one is finished.')
      return new Promise<void>((resolve, reject) => {
        this.scheduleTestRunsQueue.push({
          runTests: () => {
            log.verbose?.('Scheduled test run is starting now.')
            return this.runTestItems(request, token).then(resolve, reject)
          },
          resolveWithoutRunning: resolve,
        })
      })
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
    const request = primaryRequest || this.nonContinuousRequest || this.createContinuousRequest()

    if (!files.length) {
      log.verbose?.('Started an empty test run. This should not happen...')
      return
    }

    if (!request) {
      log.verbose?.('No test run request found for', ...files.map(f => this.relative(f)))
      return
    }

    if (this.testRun) {
      log.verbose?.('Waiting for the previous test run to finish')
      await this.testRunDefer?.promise
    }

    const name = files.length > 1
      ? undefined
      : this.relative(files[0])

    const run = this.testRun = this.controller.createTestRun(request, name)
    this.testRunRequest = request
    this.testRunDefer = Promise.withResolvers()
    // run the next test when this one finished, or cancell or test runs if they were cancelled
    this.testRunDefer.promise = this.testRunDefer.promise.finally(() => {
      run.end()
      if (this.cancelled) {
        log.verbose?.('Not starting a new test run because the previous one was cancelled manually.')
        this.scheduleTestRunsQueue.forEach(item => item.resolveWithoutRunning())
        this.scheduleTestRunsQueue.length = 0
        this.cancelled = false
      }
      else {
        log.verbose?.(`Test run promise is finished, the queue is ${this.scheduleTestRunsQueue.length}`)
        this.scheduleTestRunsQueue.shift()?.runTests()
      }
    })

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
        if (testData instanceof TestCase && !testData.dynamic) {
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

  public async reportCoverage() {
    if (!('FileCoverage' in vscode))
      return

    const reportsDirectory = await this.api.waitForCoverageReport()
    const testRun = this.testRun
    if (!reportsDirectory || !testRun)
      return

    const coverage = readCoverageReport(reportsDirectory)
    // TODO: quick patch, coverage shouldn't report negative columns
    function ensureLoc(loc: any) {
      if (!loc) {
        return
      }
      if (loc.start?.column && loc.start.column < 0) {
        loc.start.column = 0
      }
      if (loc.end?.column && loc.end.column < 0) {
        loc.end.column = 0
      }
    }
    for (const file in coverage) {
      for (const key in coverage[file].branchMap) {
        const branch = coverage[file].branchMap[key]
        ensureLoc(branch.loc)
        branch.locations?.forEach((loc: any) => ensureLoc(loc))
      }
    }
    await coverageContext.applyJson(testRun, coverage)

    rm(reportsDirectory, { recursive: true, force: true }).then(() => {
      log.info('Removed coverage reports', reportsDirectory)
    }).catch(() => {
      log.error('Failed to remove coverage reports', reportsDirectory)
    })
  }

  private markTestCase(
    testRun: vscode.TestRun,
    test: vscode.TestItem,
    result: RunnerTaskResult,
  ) {
    switch (result.state) {
      case 'fail': {
        const errors = result.errors?.map(err =>
          testMessageForTestError(test, err as TestError),
        ) || []
        if (!errors.length) {
          log.verbose?.(`Test failed, but no errors found for "${test.label}"`)
          return
        }
        if (test.uri) {
          this.diagnostic?.addDiagnostic(test.uri, errors)
        }
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
        log.verbose?.(`Marking "${test.label}" as running`)
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

  private relative(file: string | ExtensionTestSpecification) {
    return relative(this.api.workspaceFolder.uri.fsPath, typeof file === 'string' ? file : file[1])
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
  return testMessage
}

function getErrorMessage(error: TestError) {
  let message = stripVTControlCharacters(error.message ?? '')
  if (typeof error.frame === 'string') {
    message += `\n${error.frame}`
  }
  else {
    const errorProperties = getErrorProperties(error)
    if (Object.keys(errorProperties).length) {
      const errorsInspect = inspect(errorProperties, {
        showHidden: false,
        colors: false,
      })
      message += `\nSerialized Error: ${errorsInspect.slice('[Object: null prototype] '.length)}`
    }
  }
  return message
}

const skipErrorProperties = new Set([
  'nameStr',
  'stack',
  'cause',
  'stacks',
  'stackStr',
  'type',
  'showDiff',
  'ok',
  'operator',
  'diff',
  'codeFrame',
  'actual',
  'expected',
  'diffOptions',
  'sourceURL',
  'column',
  'line',
  'VITEST_TEST_NAME',
  'VITEST_TEST_PATH',
  'VITEST_AFTER_ENV_TEARDOWN',
  ...Object.getOwnPropertyNames(Error.prototype),
  ...Object.getOwnPropertyNames(Object.prototype),
])

function getErrorProperties(e: TestError) {
  const errorObject = Object.create(null)
  if (e.name === 'AssertionError') {
    return errorObject
  }

  for (const key of Object.getOwnPropertyNames(e)) {
    if (!skipErrorProperties.has(key)) {
      errorObject[key] = e[key as keyof TestError]
    }
  }

  return errorObject
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

  const TestMessageStackFrame = (vscode as any).TestMessageStackFrame

  const frames = stacks.map((stack) => {
    const { sourceFilepath, line, column } = getSourceFilepathAndLocationFromStack(stack)
    const sourceUri = sourceFilepath ? vscode.Uri.file(sourceFilepath) : undefined
    return new TestMessageStackFrame(stack.method, sourceUri, new vscode.Position(line - 1, column - 1))
  });

  (testMessage as any).stackTrace = frames
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
    if (data instanceof TestFolder) {
      continue
    }
    const project = data instanceof TestFile ? data.project : data.file.project
    const key = `${project}\0${fsPath}`
    if (testFiles.has(key)) {
      continue
    }
    testFiles.add(key)
    testSpecs.push([project, fsPath])
  }
  return testSpecs
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
  return stripVTControlCharacters(output.replace(/(?<!\r)\n/g, '\r\n'))
}

function labelTestItems(items: readonly vscode.TestItem[] | undefined) {
  if (!items)
    return '<all tests>'
  return items.map(p => `"${p.label}"`).join(', ')
}
