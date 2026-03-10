import type * as vscode from 'vscode'
import type { RunHandle } from './apiProcess'
import type { ExtensionDiagnostic } from './diagnostic'
import type { ImportsBreakdownProvider } from './importsBreakdownProvider'
import type { InlineConsoleLogManager } from './inlineConsoleLog'
import type { TestTree } from './testTree'
import { VitestProcessAPI } from './apiProcess'
import { log } from './log'
import { ContinuousTestRunner, TestRunner } from './runner'
import { getTestData, TestFile, TestFolder } from './testTreeData'
import { showVitestError } from './utils'

/**
 * Per-process run queue. Ensures only one test run is active at a time per process API.
 * Creates a fresh TestRunner + process for each run, like the debug flow does.
 */
export class RunQueue {
  private currentRun: Promise<void> | undefined
  private pendingQueue: {
    runTests: () => Promise<void>
    resolveWithoutRunning: () => void
  }[] = []

  private disposed = false

  private continuousHandle: ContinuousHandle | undefined
  private continuousPromise: Promise<ContinuousHandle> | undefined
  private continuousRequests = new Set<vscode.TestRunRequest>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly testRunProfile: vscode.TestRunProfile,
    private readonly tree: TestTree,
    private readonly api: VitestProcessAPI,
    private readonly diagnostic: ExtensionDiagnostic | undefined,
    private readonly importsBreakdown: ImportsBreakdownProvider,
    private readonly inlineConsoleLog: InlineConsoleLogManager,
  ) {}

  public isContinuousTestItem(testItem: vscode.TestItem): boolean {
    for (const req of this.continuousRequests) {
      if (!req.include) {
        return true
      }
      for (const item of req.include) {
        if (includesTestItem(item, testItem)) {
          return true
        }
      }
    }
    return false
  }

  async enqueue(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    if (request.continuous)
      return this.startContinuousRun(request, token, coverage)

    if (!this.currentRun) {
      return this.executeRun(request, token, coverage)
    }

    log.verbose?.('Queueing a new test run to execute when the current one is finished.')
    return new Promise<void>((resolve) => {
      this.pendingQueue.push({
        runTests: () => this.executeRun(request, token, coverage),
        resolveWithoutRunning: resolve,
      })
    })
  }

  private async executeRun(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    this.currentRun = (async () => {
      // Each "run" click creates a new process to run tests
      // We don't reuse the established process because it's harder to track
      const api = new VitestProcessAPI(this.api.config)
      // TODO: pass down profile instead of creating a new one, same for coverage/runner - or just disable coverage continuous?
      const handle = await api.spawnForRun({
        coverage,
        // performance optimization to avoid creating unused projects
        projects: getProjectsFromRequest(request),
      })
      const runner = this.createRunner(handle, api)
      try {
        await runner.runTests(request)
      }
      finally {
        runner.dispose()
        await handle.dispose()
      }
    })()

    try {
      await this.currentRun
    }
    catch (err: any) {
      if (!err.message?.startsWith('[birpc] rpc is closed')) {
        showVitestError('Failed to run tests', err)
      }
    }
    finally {
      this.currentRun = undefined
      this.drainQueue()
    }
  }

  private drainQueue() {
    if (this.disposed) {
      this.pendingQueue.forEach(p => p.resolveWithoutRunning())
      this.pendingQueue.length = 0
      return
    }
    const next = this.pendingQueue.shift()
    if (next) {
      log.verbose?.(`Running next tests in the queue`)
      next.runTests().then(next.resolveWithoutRunning, next.resolveWithoutRunning)
    }
  }

  private continuousTimer: NodeJS.Timeout | undefined

  private async startContinuousRun(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    this.continuousRequests.add(request)

    token.onCancellationRequested(() => {
      this.continuousRequests.delete(request)
      log.verbose?.('Continuous request was cancelled')

      if (this.continuousRequests.size) {
        clearTimeout(this.continuousTimer)
        const handle = this.continuousHandle
        handle?.runner.syncWatcher().catch((error) => {
          log.error('Failed to update the watcher state', error)
        })
        return
      }

      if (this.continuousTimer) {
        return
      }

      this.continuousTimer = setTimeout(() => {
        if (!this.continuousRequests.size && this.continuousHandle) {
          log.verbose?.('Stopping the continuous process because there are no more requests.')
          this.continuousHandle.dispose()
        }
        this.continuousTimer = undefined
      }, 1000)
    })

    const handle = await this.spawnForContinuesRun(coverage)

    // it's possible that request was cancelled before we spawn the process
    if (this.continuousRequests.size) {
      await handle.runner.syncWatcher()
    }
    else {
      log.verbose?.('Closing the continues process because requests were cancelled.')
      await handle.dispose()
    }
  }

  private async spawnForContinuesRun(coverage: boolean) {
    if (this.continuousHandle) {
      return this.continuousHandle
    }
    if (this.continuousPromise) {
      return await this.continuousPromise
    }

    this.continuousPromise = (async () => {
      const handle = await this.api.spawnForRun({ coverage })
      const runner = this.createContinuousRunner(handle)

      const offExit = handle.process.onExit(() => {
        // Unexpected exit, make sure we cleanup the state
        if (this.continuousHandle) {
          showVitestError('The process exited unexpectedly')
          runner.dispose()
          this.continuousHandle = undefined
        }
      })

      this.continuousHandle = {
        runner,
        dispose: async () => {
          offExit()
          this.continuousHandle = undefined
          runner.dispose()
          await handle.dispose()
        },
      }
      return this.continuousHandle
    })().finally(() => (this.continuousPromise = undefined))

    return this.continuousPromise
  }

  private createRunner(handle: RunHandle, api?: VitestProcessAPI) {
    return new TestRunner(
      handle,
      this.controller,
      this.tree,
      api || this.api,
      this.diagnostic,
      this.importsBreakdown,
      this.inlineConsoleLog,
    )
  }

  private createContinuousRunner(handle: RunHandle) {
    return new ContinuousTestRunner(
      handle,
      this.controller,
      this.tree,
      this.api,
      this.diagnostic,
      this.importsBreakdown,
      this.inlineConsoleLog,
      this.testRunProfile,
      this.continuousRequests,
    )
  }

  dispose() {
    this.disposed = true
    this.pendingQueue.forEach(p => p.resolveWithoutRunning())
    this.pendingQueue.length = 0
    this.api.cancelRun()
  }
}

interface ContinuousHandle {
  runner: ContinuousTestRunner
  dispose: () => Promise<void>
}

function includesTestItem(item: vscode.TestItem, testItem: vscode.TestItem): boolean {
  if (item === testItem) {
    return true
  }
  for (const [, child] of item.children) {
    if (includesTestItem(child, testItem)) {
      return true
    }
  }
  return false
}

function getProjectsFromRequest(request: vscode.TestRunRequest): string[] | undefined {
  const include = request.include
  if (!include?.length)
    return undefined
  const projects = new Set<string>()
  for (const test of include) {
    const data = getTestData(test)
    if (data instanceof TestFolder)
      return undefined
    const project = data instanceof TestFile ? data.project : data.file.project
    projects.add(project)
  }
  return [...projects]
}
