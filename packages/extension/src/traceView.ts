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

type TraceSelectionMessage = {
  type: 'traceSelection'
  revision: number
  testId: string | null
  traceAttempt: string | null
  traceStep: number
}

interface TraceViewState {
  panel: vscode.WebviewPanel
  target: TraceViewTarget
  watcher: vscode.FileSystemWatcher
  traceAttempt?: string
  traceStep: number
  refreshTimer?: ReturnType<typeof setTimeout>
}

export class TraceViewManager {
  private targets = new Map<vscode.TestItem, TraceViewTarget>()
  private viewState?: TraceViewState
  private revision = 0

  dispose() {
    this.viewState?.panel.dispose()
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

    const targets = findTraceViewTargets(apiId, reportPath, files)
    for (const target of targets) {
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
    if (!target) return

    const reportUri = vscode.Uri.file(target.reportPath)
    try {
      await vscode.workspace.fs.stat(reportUri)
    } catch {
      await vscode.window.showWarningMessage(
        `The Vitest HTML report does not exist at ${target.reportPath}.`,
      )
      return
    }

    let viewState = this.viewState
    if (!viewState) {
      const panel = vscode.window.createWebviewPanel(
        'vitest.traceView',
        'Vitest Trace View',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
      )
      viewState = {
        panel,
        target,
        watcher: this.watchReport(target.reportPath),
        traceStep: 0,
      }
      this.viewState = viewState
      panel.webview.onDidReceiveMessage((message: TraceSelectionMessage) => {
        const viewState = this.viewState
        if (
          viewState?.panel === panel &&
          message.type === 'traceSelection' &&
          message.revision === this.revision &&
          message.testId === viewState.target.testId
        ) {
          viewState.traceAttempt = message.traceAttempt ?? undefined
          viewState.traceStep = message.traceStep
        }
      })
      panel.onDidDispose(() => {
        const viewState = this.viewState
        if (viewState?.panel !== panel) return
        viewState.watcher.dispose()
        clearTimeout(viewState.refreshTimer)
        this.viewState = undefined
        this.revision++
      })
    } else {
      clearTimeout(viewState.refreshTimer)
      viewState.watcher.dispose()
      viewState.watcher = this.watchReport(target.reportPath)
      viewState.target = target
      viewState.traceAttempt = undefined
      viewState.traceStep = 0
    }
    viewState.panel.reveal(undefined, true)
    await this.refresh()
  }

  private watchReport(reportPath: string) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(vscode.Uri.file(reportPath), '..'),
        '{index.html,ui/html.meta.json.gz}',
      ),
    )
    const debouncedRefresh = () => {
      const viewState = this.viewState
      if (viewState?.watcher !== watcher) return
      clearTimeout(viewState.refreshTimer)
      viewState.refreshTimer = setTimeout(() => void this.refresh(), 150)
    }
    watcher.onDidChange(debouncedRefresh)
    watcher.onDidCreate(debouncedRefresh)
    return watcher
  }

  private async refresh() {
    const viewState = this.viewState
    if (!viewState) return
    const { panel, target } = viewState
    const revision = ++this.revision
    const hasTrace = [...this.targets.values()].some(
      (candidate) => candidate.apiId === target.apiId && candidate.testId === target.testId,
    )
    if (!hasTrace) {
      panel.webview.html = `<!DOCTYPE html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'">
        </head><body><p>The selected test has no trace in the latest run.
        Open Trace View on a test to select one.</p></body></html>`
      return
    }
    const traceViewUrlHash = createTraceViewUrlHash(
      target,
      viewState.traceStep,
      viewState.traceAttempt,
    )
    try {
      const reportUri = vscode.Uri.file(target.reportPath)
      const bytes = await vscode.workspace.fs.readFile(reportUri)
      if (revision !== this.revision || viewState !== this.viewState || target !== viewState.target)
        return
      const directory = vscode.Uri.joinPath(reportUri, '..')
      panel.webview.options = { enableScripts: true, localResourceRoots: [directory] }
      panel.webview.html = transformTraceViewHtml(
        Buffer.from(bytes).toString('utf8'),
        panel.webview,
        directory,
        traceViewUrlHash,
        revision,
      )
    } catch (error) {
      if (
        revision === this.revision &&
        viewState === this.viewState &&
        target === viewState.target
      ) {
        void vscode.window.showWarningMessage(
          `Could not load Vitest trace report: ${String(error)}`,
        )
      }
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

function createTraceViewUrlHash(target: TraceViewTarget, traceStep = 0, traceAttempt?: string) {
  // https://github.com/vitest-dev/vitest/blob/decfeb61c71a93372f84b6d43893df86a1756308/packages/ui/client/composables/params.ts#L3-L24
  const params = new URLSearchParams({
    file: target.fileId,
    layout: 'trace',
    view: 'editor',
    test: target.testId,
    traceStep: String(traceStep),
  })
  if (traceAttempt) {
    params.set('traceAttempt', traceAttempt)
  }
  return `/?${params}`
}

function transformTraceViewHtml(
  html: string,
  webview: vscode.Webview,
  directory: vscode.Uri,
  traceViewUrlHash: string,
  revision: number,
) {
  const base = `${webview.asWebviewUri(directory).toString()}/`
  const nonce = randomBytes(16).toString('hex')
  const csp = [
    `default-src 'none'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} https://fonts.googleapis.com 'unsafe-inline'`,
    `img-src ${webview.cspSource} data: blob: https:`,
    `font-src ${webview.cspSource} data: https:`,
    `connect-src ${webview.cspSource}`,
    `frame-src 'self' blob: data:;`,
  ].join('; ')
  // Resolve metadata from the report directory instead of the webview URL.
  const metadata = webview.asWebviewUri(vscode.Uri.joinPath(directory, 'ui', 'html.meta.json.gz'))
  html = html.replace(
    /new URL\("\.\/ui\/html\.meta\.json\.gz", window\.location\.href\)/g,
    JSON.stringify(metadata.toString()),
  )
  // Resolve relative asset URLs from the report directory.
  html = html.replace(/<(script|link|img|source)\b[^>]*>/gi, (tag) =>
    tag.replace(/(\s)(src|href)\s*=\s*(['"])(.*?)\3/gi, (attribute, space, name, quote, value) => {
      if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return attribute
      const url = new URL(value.replace(/&amp;/g, '&'), base).href
      return `${space}${name}=${quote}${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${quote}`
    }),
  )
  html = html.replace(/<script\b/g, `<script nonce="${nonce}"`)
  html = html.replace(
    /<head\b[^>]*>/i,
    `$&
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <style>${TRACE_VIEW_CSS}</style>
    <script nonce="${nonce}">
      (${initializeTraceView.toString()})(acquireVsCodeApi(), window, ${JSON.stringify(traceViewUrlHash)}, ${revision});
    </script>`,
  )
  return html
}

const TRACE_VIEW_CSS = `
  body {
    padding: 0;
    color: var(--color-text);
  }
  html:not(.dark) {
    background-color: white;
    color-scheme: light;
  }
`

function initializeTraceView(vscode: any, window: any, traceViewUrlHash: string, revision: number) {
  const reportSelection = () => {
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    const step = params.get('traceStep')
    if (step !== null) {
      vscode.postMessage({
        type: 'traceSelection',
        revision,
        testId: params.get('test'),
        traceAttempt: params.get('traceAttempt'),
        traceStep: Number(step),
      } satisfies TraceSelectionMessage)
    }
  }
  // Vitest updates URL parameters through History, which does not
  // emit hashchange events.
  for (const method of ['replaceState', 'pushState']) {
    const original = window.history[method]
    window.history[method] = function (...args: any[]) {
      const result = original.apply(this, args)
      reportSelection()
      return result
    }
  }
  window.addEventListener('hashchange', reportSelection)
  window.addEventListener('popstate', reportSelection)
  window.location.hash = traceViewUrlHash
}
