import type { RunnerTask, RunnerTestFile } from 'vitest'
import type { TestTree } from './testTree'
import * as vscode from 'vscode'

interface TraceReportTarget {
  apiId: string
  reportPath: string
  fileId: string
  testId: string
}

export class TraceReportManager {
  private targets = new Map<vscode.TestItem, TraceReportTarget>()

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

    for (const target of findTraceReportTargets(apiId, reportPath, files)) {
      const item = tree.getTestItemByTaskId(target.testId)
      if (item) {
        this.targets.set(item, target)
      }
    }
    await this.updateContext()
  }

  private updateContext() {
    return vscode.commands.executeCommand(
      'setContext',
      'vitest.traceReportTests',
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
    const url = createTraceReportUrl(target)
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

function findTraceReportTargets(
  apiId: string,
  reportPath: string,
  files: RunnerTestFile[],
): TraceReportTarget[] {
  const targets: TraceReportTarget[] = []
  for (const file of files) {
    const queue: RunnerTask[] = [file]
    for (let index = 0; index < queue.length; index++) {
      const task = queue[index]
      if (task.type === 'test') {
        const artifacts = (task as any).artifacts as { type: string }[] | undefined
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

function createTraceReportUrl(target: TraceReportTarget) {
  const params = new URLSearchParams({
    file: target.fileId,
    view: 'editor',
    test: target.testId,
    traceStep: '0',
  })
  return `${vscode.Uri.file(target.reportPath).toString(true)}#/?${params}`
}
