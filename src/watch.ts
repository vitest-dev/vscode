import path from 'node:path'
import { getTasks } from '@vitest/ws-client'
import { effect, reactive, ref } from '@vue/reactivity'
import type { ErrorWithDiff, File, ParsedStack, Task } from 'vitest'
import type { TestController, TestItem, TestRun, WorkspaceFolder } from 'vscode'
import { Disposable, Location, Position, TestMessage, TestRunRequest, Uri } from 'vscode'
import { Lock } from 'mighty-promise'
import * as vscode from 'vscode'
import { getRootConfig } from './config'
import type { TestFileDiscoverer } from './discover'
import type { TestFile } from './TestData'
import { TestCase, TestDescribe, WEAKMAP_TEST_DATA } from './TestData'
import { log } from './log'
import type { VitestFolderAPI } from './api'
import { StateManager } from './pure/watch/ws-client'

export interface DebuggerLocation {
  path: string
  line: number
  column: number
}

export class TestWatcher extends Disposable {
  static cache: Record<number, TestWatcher> = {}
  static isWatching(id: number) {
    return !!this.cache[id]?.isWatching.value
  }

  static create(
    ctrl: TestController,
    discover: TestFileDiscoverer,
    workspace: WorkspaceFolder,
    id: number,
    api: VitestFolderAPI,
  ) {
    if (this.cache[id])
      return this.cache[id]

    TestWatcher.cache[id] = new TestWatcher(id, ctrl, discover, workspace, api)

    return TestWatcher.cache[id]
  }

  public isWatching = ref(false)
  public isRunning = ref(false)
  public testStatus = ref({ passed: 0, failed: 0, skipped: 0 })
  private lock = new Lock()
  private vitestState = reactive(new StateManager())
  private run: TestRun | undefined
  private constructor(
    readonly id: number,
    private ctrl: TestController,
    private discover: TestFileDiscoverer,
    readonly workspace: WorkspaceFolder,
    readonly api: VitestFolderAPI,
  ) {
    super(() => {
      this.dispose()
    })
  }

  public async watch() {
    const release = await this.lock.acquire()
    try {
      if (this.isWatching.value)
        return

      this.isRunning.value = true
      this.isWatching.value = true
      const logs = [] as string[]
      let timer: any
      this.api.onConsoleLog(({ content }) => {
        logs.push(content)
        clearTimeout(timer)
        timer = setTimeout(() => {
          log.info(logs.join('\n'))
          logs.length = 0
        }, 200)
      })

      this.api.onCollected((files) => {
        this.vitestState.collectFiles(files)
      })

      this.api.onTaskUpdate((packs) => {
        this.vitestState.updateTasks(packs)

        try {
          this.isRunning.value = true
          const idMap = this.vitestState.idMap
          const fileSet = new Set<File>()
          for (const [id] of packs) {
            const task = idMap.get(id)
            if (!task)
              continue

            task.file && fileSet.add(task.file)
          }

          this.onUpdated(Array.from(fileSet), false)
        }
        catch (e) {
          console.error(e)
        }
      })

      this.api.onFinished((files, errors) => {
        errors?.forEach((error: any) => {
          if (error && typeof error === 'object' && (error.stack || error.message))
            log.error(error.stack || error.message)
        })

        try {
          this.isRunning.value = false
          this.onUpdated(files, true)
          if (!this.run)
            return

          this.run.end()
          this.run = undefined
          this.updateStatus()
        }
        catch (e) {
          console.error(e)
        }
      })

      effect(() => {
        this.onFileUpdated(this.vitestState.getFiles())
      })

      await this.api.runFiles()

      this.updateStatus()
      this.isRunning.value = false
    }
    finally {
      release()
    }
  }

  updateStatus() {
    let passed = 0
    let failed = 0
    let skipped = 0
    const idMap = this.vitestState.idMap
    for (const task of idMap.values()) {
      if (task.type !== 'test')
        continue

      if (!task.result) {
        skipped++
        continue
      }
      if (task.result.state === 'pass')
        passed++

      if (task.result.state === 'fail')
        failed++
    }

    this.testStatus.value = { passed, failed, skipped }
    if (getRootConfig().showFailMessages && failed > 0)
      vscode.window.showErrorMessage(`Vitest: You have ${failed} failing Unit Test(s).`)
  }

  public runTests(tests?: readonly TestItem[]) {
    if (tests == null) {
      const files = this.vitestState.getFiles()
      this.runFiles(files)
      return
    }

    this.runFiles(
      this.vitestState.getFiles().filter(file =>
        tests.some(test =>
          WEAKMAP_TEST_DATA.get(test)!.getFilePath().includes(file.filepath),
        ),
      ),
    )
  }

  private runFiles(files: File[]): Promise<void> | undefined {
    if (!this.run)
      this.run = this.ctrl.createTestRun(new TestRunRequest(undefined, undefined, undefined, true))

    for (const file of files) {
      const data = this.discover.discoverTestFromPath(this.ctrl, file.filepath)

      const run = this.run
      started(data.item)

      function started(item: TestItem) {
        run.started(item)
        if (item.children) {
          item.children.forEach((child) => {
            started(child)
          })
        }
      }
    }

    files.forEach((f) => {
      delete f.result
      getTasks(f).forEach(i => delete i.result)
    })

    return this.api.runFiles(files.map(i => i.filepath))
  }

  private readonly onFileUpdated = (files?: File[]) => {
    if (files == null) {
      this.discover.watchAllTestFilesInWorkspace(this.ctrl)
    }
    else {
      for (const file of files)
        this.discover.discoverTestFromPath(this.ctrl, file.filepath)
    }
  }

  private readonly onUpdated = (
    files: File[] | undefined,
    finished: boolean,
  ) => {
    if (!files)
      return

    const isFirstUpdate = !this.run
    if (!this.run)
      this.run = this.ctrl.createTestRun(new TestRunRequest(undefined, undefined, undefined, true))

    const discover = this.discover
    const ctrl = this.ctrl
    const run = this.run
    syncFilesTestStatus({ files, discover, ctrl, run, finished, isFirstUpdate })
  }

  public async dispose() {
    const release = await this.lock.acquire()
    try {
      log.info('Stop watch mode')
      this.isWatching.value = false
      this.isRunning.value = false
      this.api.clearListeners()
    }
    finally {
      release()
    }
  }
}

function getSourceFilepathAndLocationFromStack(stack: ParsedStack): { sourceFilepath?: string; line: number; column: number } {
  return {
    sourceFilepath: stack.file.replace(/\//g, path.sep),
    line: stack.line,
    column: stack.column,
  }
}

function parseLocationFromStacks(testItem: TestItem, stacks: ParsedStack[]): DebuggerLocation | undefined {
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

function testMessageForTestError(testItem: TestItem, error: ErrorWithDiff | undefined): TestMessage {
  let testMessage
  if (error?.actual != null && error?.expected != null)
    testMessage = TestMessage.diff(error?.message ?? '', error.expected, error.actual)
  else
    testMessage = new TestMessage(error?.message ?? '')

  const location = parseLocationFromStacks(testItem, error?.stacks ?? [])
  if (location) {
    const position = new Position(location.line - 1, location.column - 1)
    testMessage.location = new Location(Uri.file(location.path), position)
  }
  return testMessage
}

export function syncFilesTestStatus(
  {
    files,
    discover,
    ctrl,
    run,
    finished,
    isFirstUpdate,
    finishedTests = new Set(),
  }: {
    files: File[]
    discover: TestFileDiscoverer
    ctrl: TestController
    run: TestRun
    finished: boolean
    isFirstUpdate: boolean
    finishedTests?: Set<TestItem>
  },
) {
  for (const vitestFile of files) {
    const vscodeFile = discover.discoverTestFromPath(ctrl, vitestFile.filepath)
    syncTestStatusToVsCode({ run, vscodeFile, vitestFile, finished, isFirstUpdate, finishedTests })
  }
  return finishedTests
}

export function syncTestStatusToVsCode(
  {
    run,
    vscodeFile,
    vitestFile,
    finished,
    isFirstUpdate,
    finishedTests,
  }: {
    run: TestRun
    vscodeFile: TestFile
    vitestFile: File
    finished: boolean
    isFirstUpdate: boolean
    finishedTests: Set<TestItem>
  },
) {
  const groups = groupTasksByPattern(new Map(), vscodeFile.children, vitestFile.tasks)
  for (const [data, tasks] of groups.entries()) {
    if (finished)
      appendTestOutputs(run, data, tasks)

    const primaryTask = getPrimaryResultTask(tasks)
    if (primaryTask?.result == null) {
      if (finished) {
        finishedTests.add(data.item)
        run.skipped(data.item)
      }
      else if (isFirstUpdate) {
        run.started(data.item)
      }
    }
    else {
      if (finishedTests.has(data.item))
        continue

      const duration = tasks.reduce((acc, i) => acc + (i.result?.duration ?? 0), 0)
      const errors = tasks.flatMap(i => i.result?.errors ?? [])
      switch (primaryTask?.result?.state) {
        case 'pass':
          run.passed(data.item, duration)
          finishedTests.add(data.item)
          break
        case 'fail':
          run.failed(
            data.item,
            errors.map(i => testMessageForTestError(data.item, i)),
            duration,
          )
          finishedTests.add(data.item)
          break
        case 'skip':
        case 'todo':
          run.skipped(data.item)
          finishedTests.add(data.item)
          break
        case 'run':
          run.started(data.item)
          break
        case 'only':
          break
        default:
          console.error('unexpected result state', tasks)
      }
    }
  }
}

function groupTasksByPattern(
  map: Map<TestCase | TestDescribe, Task[]>,
  vscode: (TestDescribe | TestCase)[],
  vitest: Task[],
) {
  const set = new Set(vitest)
  for (const descOrTest of vscode) {
    const tasks = matchTask(descOrTest, set)
    if (tasks.length === 0)
      continue

    if (!map.has(descOrTest))
      map.set(descOrTest, [])

    map.get(descOrTest)!.push(...tasks)

    for (const task of tasks) {
      if (task.type === 'suite')
        groupTasksByPattern(map, (descOrTest as TestDescribe).children, task.tasks)
    }
  }
  return map
}

function getPrimaryResultTask(tasks: Task[]): Task | undefined {
  const failedOne = tasks.find(i => i.result?.state === 'fail')
  if (failedOne)
    return failedOne
  const runningOne = tasks.find(i => i.result?.state === 'run')
  if (runningOne)
    return runningOne
  const allPassed = tasks.every(i => i.result?.state === 'pass')
  if (allPassed)
    return tasks[0]
  const allSkipped = tasks.every(i => i.result?.state === 'skip')
  if (allSkipped)
    return tasks[0]
  return tasks[0]
}

function getFullTaskName(task: Task): string {
  if (task.suite) {
    const suiteName = getFullTaskName(task.suite)
    return `${suiteName} ${task.name}`
  }
  return task.name
}

function matchTask(
  vscode: TestDescribe | TestCase,
  candidates: Set<Task>,
): Task[] {
  const result: Task[] = []
  for (const task of candidates) {
    if (task.type === 'suite' && !(vscode instanceof TestDescribe))
      continue

    if ((task.type === 'test' || task.type === 'custom') && !(vscode instanceof TestCase))
      continue

    const fullTaskName = getFullTaskName(task)
    const pattern = vscode.nameResolver.asFullMatchPattern()
    const fullCandidatesPattern = new RegExp(pattern)
    if (fullTaskName.match(fullCandidatesPattern))
      result.push(task)
  }
  for (const task of result)
    candidates.delete(task)

  return result
}

function appendTestOutputs(run: TestRun, data: TestDescribe | TestCase, tasks: Task[]) {
  for (const task of tasks) {
    if (!task.logs)
      continue
    // for now, display logs after all tests are finished.
    // TODO: append logs during test execution using `onUserConsoleLog` rpc.
    for (const log of task.logs) {
      // LF to CRLF https://code.visualstudio.com/api/extension-guides/testing#test-output
      const output = log.content.replace(/(?<!\r)\n/g, '\r\n')
      run.appendOutput(output, undefined, data.item)
    }
  }
}
