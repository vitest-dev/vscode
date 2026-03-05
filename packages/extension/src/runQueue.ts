import type * as vscode from 'vscode'
import type { RunHandle } from './apiProcess'
import type { ExtensionDiagnostic } from './diagnostic'
import type { ImportsBreakdownProvider } from './importsBreakdownProvider'
import type { InlineConsoleLogManager } from './inlineConsoleLog'
import type { TestTree } from './testTree'
import { VitestProcessAPI } from './apiProcess'
import { log } from './log'
import { ContinuousTestRunner, TestRunner } from './runner'

/**
 * Per-folder run queue. Ensures only one test run is active at a time per folder API.
 * Creates a fresh TestRunner + process for each run, like the debug flow does.
 */
export class RunQueue {
  private currentRun: Promise<void> | undefined
  private pendingQueue: { run: () => Promise<void>; resolve: () => void }[] = []
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

  async enqueue(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    if (request.continuous)
      return this.startContinuousRun(request, token, coverage)

    if (!this.currentRun) {
      return this.executeRun(request, token, coverage)
    }

    log.verbose?.('Queueing a new test run to execute when the current one is finished.')
    return new Promise<void>((resolve) => {
      this.pendingQueue.push({
        run: () => this.executeRun(request, token, coverage),
        resolve,
      })
    })
  }

  private async executeRun(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    this.currentRun = (async () => {
      const api = new VitestProcessAPI(this.api.config)
      const handle = await api.spawnForRun({ coverage })
      const runner = this.createRunner(handle)
      try {
        await runner.runTests(request, token)
      }
      finally {
        runner.dispose()
        await handle.close()
      }
    })()

    try {
      await this.currentRun
    }
    catch (err: any) {
      if (!err.message?.startsWith('[birpc] rpc is closed'))
        log.error('Failed to run tests', err)
    }
    finally {
      this.currentRun = undefined
      this.drainQueue()
    }
  }

  private drainQueue() {
    if (this.disposed) {
      this.pendingQueue.forEach(p => p.resolve())
      this.pendingQueue.length = 0
      return
    }
    const next = this.pendingQueue.shift()
    if (next) {
      log.verbose?.(`Running next tests in the queue`)
      next.run().then(next.resolve, next.resolve)
    }
  }

  private continuousTimer: NodeJS.Timeout | undefined

  private async startContinuousRun(request: vscode.TestRunRequest, token: vscode.CancellationToken, coverage: boolean) {
    this.continuousRequests.add(request)

    token.onCancellationRequested(() => {
      this.continuousRequests.delete(request)

      if (this.continuousTimer || this.continuousRequests.size) {
        const handle = this.continuousHandle
        handle?.runner.watchTests().catch((error) => {
          log.error('Failed to update the watcher state', error)
        })
        return
      }

      this.continuousTimer = setTimeout(() => {
        if (!this.continuousRequests.size && this.continuousHandle) {
          log.verbose?.('Stopping the continuous process because there are no more requests.')
          this.continuousHandle.close()
        }
        this.continuousTimer = undefined
      }, 500)
    })

    const handle = await this.spawnForContinuesRun(coverage)

    // it's possible that request was cancelled before we spawn the process
    if (this.continuousRequests.size) {
      await handle.runner.watchTests()
    }
    else {
      log.verbose?.('Closing the continues process because requests were cancelled.')
      await handle.close()
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
      handle.process.onExit(() => {
        // Unexpected exit, make sure we cleanup the state
        if (this.continuousHandle) {
          runner.dispose()
          this.continuousHandle = undefined
        }
      })
      this.continuousHandle = {
        runner,
        close: async () => {
          this.continuousHandle = undefined
          runner.dispose()
          await handle.close().catch((error) => {
            log.error('Failed to close the continuous runner', error)
          })
        },
      }
      return this.continuousHandle
    })().finally(() => (this.continuousPromise = undefined))
    return this.continuousPromise
  }

  private createRunner(handle: RunHandle) {
    return new TestRunner(
      handle,
      this.controller,
      this.tree,
      this.api,
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
    this.pendingQueue.forEach(p => p.resolve())
    this.pendingQueue.length = 0
    this.api.cancelRun()
  }
}

interface ContinuousHandle {
  runner: ContinuousTestRunner
  close: () => Promise<void>
}
