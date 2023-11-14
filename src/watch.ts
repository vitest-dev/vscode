import type { ChildProcess } from 'child_process'
import path from 'path'
import getPort from 'get-port'
import { getTasks } from '@vitest/ws-client'
import { effect, ref } from '@vue/reactivity'
import Fuse from 'fuse.js'
import type { ErrorWithDiff, File, ParsedStack, Task } from 'vitest'
import type { TestController, TestItem, TestRun, WorkspaceFolder } from 'vscode'
import { Disposable, Location, Position, TestMessage, TestRunRequest, Uri } from 'vscode'
import { Lock } from 'mighty-promise'
import * as vscode from 'vscode'
import { getConfig, getRootConfig } from './config'
import type { TestFileDiscoverer } from './discover'
import { execWithLog } from './pure/utils'
import { buildWatchClient } from './pure/watch/client'
import type { TestFile } from './TestData'
import { TestCase, TestDescribe, WEAKMAP_TEST_DATA } from './TestData'
import { log } from './log'

export interface DebuggerLocation { path: string; line: number; column: number }
export class TestWatcher extends Disposable {
  static cache: Record<number, TestWatcher> = {}
  static isWatching(id: number) {
    return !!this.cache[id]?.isWatching.value
  }

  static create(
    ctrl: TestController,
    discover: TestFileDiscoverer,
    vitest: { cmd: string; args: string[] },
    workspace: WorkspaceFolder,
    id: number,
  ) {
    if (this.cache[id])
      return this.cache[id]

    TestWatcher.cache[id] = new TestWatcher(id, ctrl, discover, vitest, workspace)

    return TestWatcher.cache[id]
  }

  public isWatching = ref(false)
  public isRunning = ref(false)
  public testStatus = ref({ passed: 0, failed: 0, skipped: 0 })
  private lock = new Lock()
  private process?: ChildProcess
  private vitestState?: ReturnType<typeof buildWatchClient>
  private run: TestRun | undefined
  private constructor(
    readonly id: number,
    private ctrl: TestController,
    private discover: TestFileDiscoverer,
    private vitest: { cmd: string; args: string[] },
    readonly workspace: WorkspaceFolder,
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
      const port = await getPort({ port: 51204 })
      let timer: any
      this.process = execWithLog(
        this.vitest.cmd,
        [...this.vitest.args, '--api.port', port.toString(), '--api.host', '127.0.0.1'],
        {
          cwd: this.workspace.uri.fsPath,
          env: { ...process.env, ...getConfig(this.workspace).env },
        },
        (line) => {
          logs.push(line)
          clearTimeout(timer)
          timer = setTimeout(() => {
            log.info(logs.join('\n'))
            logs.length = 0
          }, 200)
        },
        (line) => {
          logs.push(line)
          clearTimeout(timer)
          timer = setTimeout(() => {
            log.info(logs.join('\n'))
            logs.length = 0
          }, 200)
        },
      ).child

      this.process.on('exit', () => {
        log.info('VITEST WATCH PROCESS EXIT')
      })

      this.vitestState = buildWatchClient({
        port,
        handlers: {
          onTaskUpdate: (packs) => {
            try {
              if (!this.vitestState)
                return

              this.isRunning.value = true
              const idMap = this.vitestState.client.state.idMap
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
          },
          onFinished: (files) => {
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
          },
        },
        // vitest could take up to 10 seconds to start up on some computers, so reconnects need to be long enough to handle that
        reconnectInterval: 500,
        reconnectTries: 20,
      })

      effect(() => {
        this.onFileUpdated(this.vitestState!.files.value)
      })
      return this.vitestState.loadingPromise.then(() => {
        this.updateStatus()
        this.isRunning.value = false
      })
    }
    finally {
      release()
    }
  }

  updateStatus() {
    if (!this.vitestState)
      return

    let passed = 0
    let failed = 0
    let skipped = 0
    const idMap = this.vitestState.client.state.idMap
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
    if (!this.vitestState)
      return

    if (tests == null) {
      const files = this.vitestState.files.value
      this.runFiles(files)
      return
    }

    this.runFiles(
      this.vitestState.files.value.filter(file =>
        tests.some(test =>
          WEAKMAP_TEST_DATA.get(test)!.getFilePath().includes(file.filepath),
        ),
      ),
    )
  }

  private runFiles(files: File[]): Promise<void> | undefined {
    if (!this.vitestState)
      return

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

    const client = this.vitestState.client
    return client.rpc.rerun(files.map(i => i.filepath))
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
    if (isFirstUpdate)
      this.run = this.ctrl.createTestRun(new TestRunRequest(undefined, undefined, undefined, true))

    const discover = this.discover
    const ctrl = this.ctrl
    const run = this.run
    syncFilesTestStatus(files, discover, ctrl, run, finished, isFirstUpdate)
  }

  public async dispose() {
    const release = await this.lock.acquire()
    try {
      log.info('Stop watch mode')
      this.isWatching.value = false
      this.isRunning.value = false
      this.vitestState?.client.dispose()
      this.process?.kill()
      this.process = undefined
      this.vitestState = undefined
    }
    finally {
      release()
    }
  }
}

function getSourceFilepathAndLocationFromStack(stack: ParsedStack): { sourceFilepath?: string; line: number; column: number } {
  if (stack.sourcePos) {
    return {
      sourceFilepath: stack.sourcePos.source?.replace(/\//g, path.sep),
      line: stack.sourcePos.line,
      column: stack.sourcePos.column,
    }
  }

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
    if (sourceFilepath !== targetFilepath || isNaN(column) || isNaN(line))
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
  files: File[],
  discover: TestFileDiscoverer,
  ctrl: TestController,
  run: TestRun | undefined,
  finished: boolean,
  isFirstUpdate: boolean,
  finishedTest: Set<TestItem> = new Set(),
) {
  for (const file of files) {
    const data = discover.discoverTestFromPath(ctrl, file.filepath)
    run && syncTestStatusToVsCode(run, data, file, finished, isFirstUpdate, finishedTest)
  }
  return finishedTest
}

export function syncTestStatusToVsCode(
  run: TestRun,
  vscodeFile: TestFile,
  vitestFile: File,
  finished: boolean,
  isFirstUpdate: boolean,
  finishedTest?: Set<TestItem>,
) {
  sync(run, vscodeFile.children, vitestFile.tasks)

  function sync(
    run: TestRun,
    vscode: (TestDescribe | TestCase)[],
    vitest: Task[],
  ) {
    const set = new Set(vscode)
    for (const task of vitest) {
      const data = matchTask(task, set, task.type)
      if (task.type === 'test') {
        if (task.result == null) {
          if (finished) {
            finishedTest && finishedTest.add(data.item)
            run.skipped(data.item)
          }
          else if (isFirstUpdate) { run.started(data.item) }
        }
        else {
          if (finishedTest) {
            if (finishedTest.has(data.item))
              continue
          }

          switch (task.result?.state) {
            case 'pass':
              run.passed(data.item, task.result.duration)
              finishedTest && finishedTest.add(data.item)
              break
            case 'fail':
              run.failed(
                data.item,
                testMessageForTestError(data.item, task.result.error),
                task.result.duration,
              )
              finishedTest && finishedTest.add(data.item)
              break
            case 'skip':
            case 'todo':
              run.skipped(data.item)
              finishedTest && finishedTest.add(data.item)
              break
            case 'run':
              run.started(data.item)
              break
            case 'only':
              break
            default:
              console.error('unexpected result state', task.result)
          }
        }
      }
      else {
        sync(run, (data as TestDescribe).children, task.tasks)
      }
    }
  }

  function matchTask(
    task: Task,
    candidates: Set<TestDescribe | TestCase>,
    type: 'suite' | 'test',
  ): TestDescribe | TestCase {
    let ans: (TestDescribe | TestCase) | undefined
    for (const candidate of candidates) {
      if (type === 'suite' && !(candidate instanceof TestDescribe))
        continue

      if (type === 'test' && !(candidate instanceof TestCase))
        continue

      if (candidate.pattern === task.name) {
        ans = candidate
        break
      }
    }

    if (ans) {
      candidates.delete(ans)
    }
    else {
      ans = new Fuse(Array.from(candidates), { keys: ['pattern'] }).search(
        task.name,
      )[0]?.item
      // should not delete ans from candidates here, because there are usages like `test.each`
      // TODO: should we create new TestCase here?
    }

    return ans
  }
}
