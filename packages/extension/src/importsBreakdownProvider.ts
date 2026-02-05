import type { SourceModuleDiagnostic } from 'vitest-vscode-shared'
import { relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { log } from './log'

export class ImportsBreakdownProvider {
  private disposables: vscode.Disposable[] = []
  private decorationType: vscode.TextEditorDecorationType

  private _decorations = new Map<string, vscode.DecorationOptions[]>()

  private showDecorations = getConfig().showImportsDuration

  constructor(
    private getSourceModuleDiagnostic: (moduleId: string) => Promise<SourceModuleDiagnostic>,
  ) {
    // Create a decoration type with gray color
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: '#808080',
        margin: '0 0 0 0.5em',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    })

    // Update decorations when the active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor)
        }
      }),
    )

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest.showImportsDuration')) {
          this.showDecorations = getConfig().showImportsDuration

          this.refreshCurrentDecorations()
        }
      }),
    )

    // Update decorations for the currently active editor
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor)
    }
  }

  public clear() {
    this._decorations.clear()
    const editor = vscode.window.activeTextEditor
    editor?.setDecorations(this.decorationType, [])
  }

  public refreshCurrentDecorations() {
    log.info('[DECOR] Reset all decorations.')
    this._decorations.clear()

    // Update decorations for the currently active editor
    if (vscode.window.activeTextEditor) {
      this.updateDecorations(vscode.window.activeTextEditor)
    }
  }

  private async updateDecorations(editor: vscode.TextEditor) {
    const document = editor.document
    if (!this.showDecorations || document.uri.scheme !== 'file' || !document.lineCount) {
      editor.setDecorations(this.decorationType, [])
      return
    }
    const fsPath = document.uri.fsPath
    if (this._decorations.has(fsPath)) {
      log.info('[DECOR] Decorations for', fsPath, 'are already cached. Displaying them.')
      editor.setDecorations(this.decorationType, this._decorations.get(fsPath)!)
      return
    }

    const diagnostic = await this.getSourceModuleDiagnostic(fsPath).catch(() => null)
    if (!diagnostic || !diagnostic.modules) {
      editor.setDecorations(this.decorationType, [])
      return
    }

    const decorations: vscode.DecorationOptions[] = []

    // TODO: untracked modules somehow?
    diagnostic.modules.forEach((diagnostic) => {
      const lineRange = editor.document.lineAt(diagnostic.start.line - 1).range

      const overallTime = diagnostic.totalTime + (diagnostic.transformTime || 0)
      let color: string | undefined
      if (overallTime >= 500) {
        color = 'rgb(248 113 113 / 0.8)'
      }
      else if (overallTime >= 100) {
        color = 'rgb(251 146 60 / 0.8)'
      }

      let diagnosticMessage = `
### VITEST DIAGNOSTIC
- It took **${formatPreciseTime(diagnostic.totalTime)}** to import this module, including static imports.
- It took **${formatPreciseTime(diagnostic.selfTime)}** to import this modules, excluding static imports.
- It took **${formatPreciseTime(diagnostic.transformTime || 0)}** to transform this module.`

      if (diagnostic.external) {
        diagnosticMessage += `\n- This module was **externalized** to [${diagnostic.resolvedUrl}](${pathToFileURL(diagnostic.resolvedId).toString()})`
      }
      if (diagnostic.importer && document.fileName !== diagnostic.importer) {
        diagnosticMessage += `\n- This module was originally imported by [${relative(document.fileName, diagnostic.importer)}](${pathToFileURL(diagnostic.importer)})`
      }

      diagnosticMessage += `\n\nYou can disable diagnostic by setting [\`vitest.showImportsDuration\`](command:workbench.action.openSettings?%5B%22vitest.showImportsDuration%22%5D) option in your VSCode settings to \`false\`.`
      const ms = new vscode.MarkdownString(diagnosticMessage)
      ms.isTrusted = true

      decorations.push({
        range: lineRange,
        hoverMessage: ms,
        renderOptions: {
          after: {
            color,
            contentText: formatTime(overallTime),
          },
        },
      })
    })

    this._decorations.set(fsPath, decorations)

    editor.setDecorations(this.decorationType, decorations)
  }

  dispose() {
    this.decorationType.dispose()
    this.disposables.forEach(d => d.dispose())
  }
}

function formatTime(time: number): string {
  if (time > 1000) {
    return `${(time / 1000).toFixed(2)}s`
  }
  return `${Math.round(time)}ms`
}

function formatPreciseTime(time: number): string {
  if (time > 1000) {
    return `${(time / 1000).toFixed(2)}s`
  }
  return `${time.toFixed(2)}ms`
}
