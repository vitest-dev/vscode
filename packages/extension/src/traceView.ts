import type { RunnerTask, RunnerTestFile } from 'vitest'
import type { TestTree } from './testTree'
import * as vscode from 'vscode'

interface TraceViewTarget {
  apiId: string
  reportPath: string
  fileId: string
  testId: string
}

export class TraceViewManager {
  private targets = new Map<vscode.TestItem, TraceViewTarget>()

  clear() {
    this.targets.clear()
    void this.updateContext()
  }

  async update(apiId: string, reportPath: string, files: RunnerTestFile[], tree: TestTree) {
    for (const [item, target] of this.targets) {
      if (target.apiId === apiId) {
        this.targets.delete(item)
      }
    }

    for (const target of findTraceViewTargets(apiId, reportPath, files)) {
      const item = tree.getTestItemByTaskId(target.testId)
      if (item) {
        this.targets.set(item, target)
      }
    }
    await this.updateContext()
  }

  private updateContext() {
    // Limit the test-item actions to tests with a recorded trace.
    return vscode.commands.executeCommand(
      'setContext',
      'vitest.traceViewTests',
      [...this.targets.keys()].map((item) => item.id),
    )
  }

  async open(testItem: vscode.TestItem) {
    const target = this.targets.get(testItem)!

    const reportUri = vscode.Uri.file(target.reportPath)
    try {
      await vscode.workspace.fs.stat(reportUri)
    } catch {
      await vscode.window.showWarningMessage(
        `The Vitest HTML report does not exist at ${target.reportPath}.`,
      )
      return
    }

    const commands = await vscode.commands.getCommands(true)
    const url = createTraceViewUrl(target)
    // The Integrated Browser command is internal; follow Simple Browser's feature detection before using it.
    // https://github.com/microsoft/vscode/blob/008427a901bf4aa79b47f175ccc8da1731750f78/extensions/simple-browser/src/extension.ts#L15-L35
    if (commands.includes('workbench.action.browser.open')) {
      await vscode.commands.executeCommand('workbench.action.browser.open', url)
    } else {
      // TODO: Support a single-file fallback because external browsers may block file:// metadata requests.
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }
  }
}

function findTraceViewTargets(
  apiId: string,
  reportPath: string,
  files: RunnerTestFile[],
): TraceViewTarget[] {
  const targets: TraceViewTarget[] = []
  for (const file of files) {
    const queue: RunnerTask[] = [file]
    for (let index = 0; index < queue.length; index++) {
      const task = queue[index]
      if (task.type === 'test') {
        // Vitest 3 does not type artifacts, while the field is provided by Vitest 5.
        // https://github.com/vitest-dev/vitest/blob/c666d149a4516761bae92ca56ce1336d2fd352c3/packages/runner/src/types/tasks.ts#L265-L279
        const { artifacts } = task as typeof task & { artifacts?: { type: string }[] }
        // https://github.com/vitest-dev/vitest/blob/decfeb61c71a93372f84b6d43893df86a1756308/packages/vitest/src/runtime/runner/types.ts#L1479-L1485
        if (artifacts?.some((artifact) => artifact.type === 'internal:browserTrace')) {
          targets.push({ apiId, reportPath, fileId: file.id, testId: task.id })
        }
      } else {
        queue.push(...task.tasks)
      }
    }
  }
  return targets
}

function createTraceViewUrl(target: TraceViewTarget) {
  // https://github.com/vitest-dev/vitest/blob/decfeb61c71a93372f84b6d43893df86a1756308/packages/ui/client/composables/params.ts#L3-L24
  const params = new URLSearchParams({
    file: target.fileId,
    view: 'editor',
    test: target.testId,
    traceStep: '0',
  })
  return `${vscode.Uri.file(target.reportPath).toString(true)}#/?${params}`
}
