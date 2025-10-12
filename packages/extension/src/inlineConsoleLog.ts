import type { UserConsoleLog } from 'vitest'
import * as vscode from 'vscode'
import { getConfig } from './config'

interface ConsoleLogEntry {
  content: string
  time: number
}

export class InlineConsoleLogManager extends vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType
  private consoleLogsByFile = new Map<string, Map<number, ConsoleLogEntry[]>>()
  private disposables: vscode.Disposable[] = []

  constructor() {
    super(() => {
      this.decorationType.dispose()
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
    })

    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: '0 0 0 3em',
        textDecoration: 'none',
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    })

    // Update decorations when active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor)
        }
      }),
    )

    // Update decorations when document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor
        if (editor && event.document === editor.document) {
          this.updateDecorations(editor)
        }
      }),
    )

    // Update decorations when configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest.showConsoleLogInline')) {
          this.refresh()
        }
      }),
    )
  }

  addConsoleLog(consoleLog: UserConsoleLog): void {
    const config = getConfig()
    if (!config.showConsoleLogInline) {
      return
    }

    // Parse origin to extract file and line number
    const location = this.parseOrigin(consoleLog.origin)
    if (!location) {
      return
    }

    const { file, line } = location

    // Store console log entry
    if (!this.consoleLogsByFile.has(file)) {
      this.consoleLogsByFile.set(file, new Map())
    }

    const fileMap = this.consoleLogsByFile.get(file)!
    if (!fileMap.has(line)) {
      fileMap.set(line, [])
    }

    fileMap.get(line)!.push({
      content: consoleLog.content,
      time: consoleLog.time,
    })

    // Update decorations for active editor if it's the affected file
    const editor = vscode.window.activeTextEditor
    if (editor && editor.document.uri.fsPath === file) {
      this.updateDecorations(editor)
    }
  }

  clear(): void {
    this.consoleLogsByFile.clear()
    this.refresh()
  }

  clearFile(file: string): void {
    this.consoleLogsByFile.delete(file)
    const editor = vscode.window.activeTextEditor
    if (editor && editor.document.uri.fsPath === file) {
      this.updateDecorations(editor)
    }
  }

  private parseOrigin(origin?: string): { file: string; line: number } | null {
    if (!origin) {
      return null
    }

    // Origin is a stack trace string. We need to extract the file path and line number.
    // Stack trace formats vary but typically look like:
    //   at functionName (file:///path/to/file.ts:10:5)
    //   at /path/to/file.ts:10:5
    //   at Object.<anonymous> (/path/to/file.ts:10:5)
    // We look for the first line that contains a file path with line:column

    const lines = origin.split('\n')
    for (const line of lines) {
      // Match various stack trace formats
      // Handles: (file:///path/to/file.ts:10:5) or (/path/to/file.ts:10:5) or just /path/to/file.ts:10:5
      const match = line.match(/(?:file:\/\/)?([^():\s]+\.(?:ts|js|jsx|tsx|mjs|cjs|cts|mts)):(\d+):(\d+)/)
      if (match) {
        const [, file, lineStr] = match
        const lineNum = Number.parseInt(lineStr, 10) - 1 // Convert to 0-based line number

        if (!Number.isNaN(lineNum) && lineNum >= 0) {
          // Clean up file:// protocol if present and decode URI components
          let cleanPath = file
          if (cleanPath.startsWith('file://')) {
            cleanPath = cleanPath.substring(7)
          }
          try {
            cleanPath = decodeURIComponent(cleanPath)
          }
          catch {
            // If decoding fails, use the original path
          }

          return { file: cleanPath, line: lineNum }
        }
      }
    }

    return null
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    const config = getConfig()
    if (!config.showConsoleLogInline) {
      editor.setDecorations(this.decorationType, [])
      return
    }

    const file = editor.document.uri.fsPath
    const fileMap = this.consoleLogsByFile.get(file)

    if (!fileMap || fileMap.size === 0) {
      editor.setDecorations(this.decorationType, [])
      return
    }

    const decorations: vscode.DecorationOptions[] = []

    fileMap.forEach((entries, line) => {
      // Skip if line is out of range
      if (line >= editor.document.lineCount) {
        return
      }

      // Combine multiple console logs on the same line
      const content = entries.map(e => this.formatContent(e.content)).join(' ')

      const lineRange = editor.document.lineAt(line).range
      const decoration: vscode.DecorationOptions = {
        range: lineRange,
        renderOptions: {
          after: {
            contentText: content,
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
          },
        },
      }

      decorations.push(decoration)
    })

    editor.setDecorations(this.decorationType, decorations)
  }

  private formatContent(content: string): string {
    // Remove trailing newlines and limit length
    const cleaned = content.trim().replace(/\n/g, ' ')
    const maxLength = 100
    if (cleaned.length > maxLength) {
      return `${cleaned.substring(0, maxLength)}...`
    }
    return cleaned
  }

  private refresh(): void {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      this.updateDecorations(editor)
    }
  }
}
