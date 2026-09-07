import type { RunnerTask, RunnerTestFile } from 'vitest'
import type { TestTree } from './testTree'
import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

interface TraceViewTarget {
  apiId: string
  reportPath: string
  fileId: string
  testId: string
}

export class TraceViewManager {
  private targets = new Map<vscode.TestItem, TraceViewTarget>()
  private panel?: vscode.WebviewPanel
  private reportPath?: string
  private watcher?: vscode.FileSystemWatcher
  private refreshTimer?: ReturnType<typeof setTimeout>
  private revision = 0

  dispose() {
    this.panel?.dispose()
    this.watcher?.dispose()
    clearTimeout(this.refreshTimer)
    this.revision++
  }

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
    const target = this.targets.get(testItem)
    if (!target)
      return

    const reportUri = vscode.Uri.file(target.reportPath)
    try {
      await vscode.workspace.fs.stat(reportUri)
    } catch {
      await vscode.window.showWarningMessage(
        `The Vitest HTML report does not exist at ${target.reportPath}.`,
      )
      return
    }

    const sameReport = this.reportPath === target.reportPath
    this.reportPath = target.reportPath
    const selection = createTraceViewUrl(target).split('#')[1]
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(
        'vitest.traceView',
        'Vitest Trace View',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
      )
      this.panel = panel
      panel.onDidDispose(() => {
        this.panel = undefined
        this.watcher?.dispose()
        clearTimeout(this.refreshTimer)
        this.revision++
      })
    }
    this.panel.reveal(undefined, true)
    if (sameReport && this.panel.webview.html) {
      await this.panel.webview.postMessage({ type: 'select', hash: selection })
      return
    }
    this.watcher?.dispose()
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
      vscode.Uri.joinPath(reportUri, '..'),
      '{index.html,ui/html.meta.json.gz}',
    ))
    const refresh = () => {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = setTimeout(() => void this.refresh(), 150)
    }
    this.watcher.onDidChange(refresh)
    this.watcher.onDidCreate(refresh)
    await this.refresh(selection)
  }

  private async refresh(selection = '') {
    const panel = this.panel
    const reportPath = this.reportPath
    if (!panel || !reportPath)
      return
    const revision = ++this.revision
    try {
      const reportUri = vscode.Uri.file(reportPath)
      const directory = vscode.Uri.joinPath(reportUri, '..')
      const bytes = await vscode.workspace.fs.readFile(reportUri)
      if (revision !== this.revision || panel !== this.panel)
        return
      panel.webview.options = { enableScripts: true, localResourceRoots: [directory] }
      const base = `${panel.webview.asWebviewUri(directory).toString()}/`
      const nonce = randomBytes(16).toString('hex')
      const source = panel.webview.cspSource
      // Adapt the reporter's generated bootstrap, which explicitly uses location
      // rather than document.baseURI. Bust metadata cache after regeneration.
      const metadata = panel.webview.asWebviewUri(vscode.Uri.joinPath(directory, 'ui', 'html.meta.json.gz'))
      let html = Buffer.from(bytes).toString('utf8').replace(
        /new URL\("\.\/ui\/html\.meta\.json\.gz", window\.location\.href\)/g,
        JSON.stringify(`${metadata.toString()}?v=${Date.now()}`),
      )
      // Keep the document base on the webview origin so history updates stay
      // same-origin. Only resource URLs should point at the report directory.
      html = html.replace(/<(script|link|img|source)\b[^>]*>/gi, tag => tag.replace(
        /(\s)(src|href)\s*=\s*(['"])(.*?)\3/gi,
        (attribute, space, name, quote, value) => {
          if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value))
            return attribute
          const url = new URL(value.replace(/&amp;/g, '&'), base).href
          return `${space}${name}=${quote}${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${quote}`
        },
      ))
      html = html.replace(/<script\b/g, `<script nonce="${nonce}"`)
      const hash = JSON.stringify(selection).replace(/</g, '\\u003c')
      html = html.replace(/<head\b[^>]*>/i, `$&
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${source} 'nonce-${nonce}'; style-src ${source} https://fonts.googleapis.com 'unsafe-inline'; img-src ${source} data: blob: https:; font-src ${source} data: https:; connect-src ${source}; frame-src 'self' blob: data:;">
        <script nonce="${nonce}">
          (() => {
            window.location.hash = ${hash};
            window.addEventListener('message', ({ data }) => {
              if (data.type === 'select') window.location.hash = data.hash;
            });
          })();
        </script>`)
      panel.webview.html = html
    } catch (error) {
      if (revision === this.revision)
        void vscode.window.showWarningMessage(`Could not load Vitest trace report: ${String(error)}`)
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
