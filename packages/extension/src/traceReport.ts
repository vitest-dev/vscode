import type { RunnerTask, RunnerTestFile } from 'vitest'
import type { TestTree } from './testTree'
import * as vscode from 'vscode'

interface TraceReportTarget {
  apiId: string
  reportPath: string
  fileId: string
  testId: string
}

function findTraceReportTargets(
  apiId: string,
  reportPath: string,
  files: RunnerTestFile[],
): TraceReportTarget[] {
  const targets: TraceReportTarget[] = []

  function visit(task: RunnerTask, fileId: string) {
    if (task.type === 'test') {
      const artifacts = (task as any).artifacts as { type: string }[] | undefined
      if (artifacts?.some((artifact) => artifact.type === 'internal:browserTrace')) {
        targets.push({ apiId, reportPath, fileId, testId: task.id })
      }
      return
    }
    task.tasks.forEach((child) => visit(child, fileId))
  }

  files.forEach((file) => visit(file, file.id))
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

  async open(testItem: vscode.TestItem | undefined) {
    const target = testItem && this.targets.get(testItem)
    if (!target) {
      await vscode.window.showInformationMessage(
        'No trace report is available for this test. Run it with browser.traceView and the HTML reporter enabled.',
      )
      return
    }

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
    if (commands.includes('workbench.action.browser.open')) {
      await vscode.commands.executeCommand('workbench.action.browser.open', url)
    } else {
      await vscode.env.openExternal(vscode.Uri.parse(url))
    }
  }
}
