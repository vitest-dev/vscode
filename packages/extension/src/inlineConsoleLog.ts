import type { ExtensionUserConsoleLog } from 'vitest-vscode-shared'
import type { TestTree } from './testTree'
import { stripVTControlCharacters } from 'node:util'
import * as vscode from 'vscode'
import { getConfig } from './config'

interface ConsoleLogEntry {
  content: string
  time: number
  testItem: vscode.TestItem | undefined
}

export class InlineConsoleLogManager extends vscode.Disposable {
  private decorationType: vscode.TextEditorDecorationType
  private consoleLogsByFile = new Map<string, Map<number, ConsoleLogEntry[]>>()
  private disposables: vscode.Disposable[] = []

  constructor(private readonly testTree: TestTree) {
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
        const file = event.document.uri.fsPath
        const fileMap = this.consoleLogsByFile.get(file)

        if (!fileMap || fileMap.size === 0) {
          return
        }

        // Adjust line numbers based on document changes
        for (const change of event.contentChanges) {
          const startLine = change.range.start.line
          const endLine = change.range.end.line
          const newLineCount = change.text.split('\n').length - 1
          const oldLineCount = endLine - startLine

          // Calculate the net change in line numbers
          const lineDelta = newLineCount - oldLineCount

          if (lineDelta !== 0) {
            // Create a new map with adjusted line numbers
            const newFileMap = new Map<number, ConsoleLogEntry[]>()

            fileMap.forEach((entries, line) => {
              let newLine = line

              // If the console log is after the change, adjust its line number
              if (line > endLine) {
                newLine = line + lineDelta
              }
              // If the console log is within the changed range, keep it at the start of the change
              else if (line >= startLine && line <= endLine) {
                newLine = startLine + newLineCount
              }

              // Ensure line number is valid
              if (newLine >= 0) {
                if (!newFileMap.has(newLine)) {
                  newFileMap.set(newLine, [])
                }
                newFileMap.get(newLine)!.push(...entries)
              }
            })

            this.consoleLogsByFile.set(file, newFileMap)
          }
        }

        // Update all visible editors showing this file
        vscode.window.visibleTextEditors.forEach((editor) => {
          if (editor.document === event.document) {
            this.updateDecorations(editor)
          }
        })
      }),
    )

    // Update decorations when configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vitest.showInlineConsoleLog')) {
          this.refresh()
        }
      }),
    )
  }

  addConsoleLog(consoleLog: ExtensionUserConsoleLog): void {
    const config = getConfig()
    if (!config.showInlineConsoleLog) {
      return
    }

    // Use pre-parsed location from worker
    if (!consoleLog.parsedLocation) {
      return
    }

    const { file, line } = consoleLog.parsedLocation

    // Store console log entry
    if (!this.consoleLogsByFile.has(file)) {
      this.consoleLogsByFile.set(file, new Map())
    }

    const fileMap = this.consoleLogsByFile.get(file)!
    if (!fileMap.has(line)) {
      fileMap.set(line, [])
    }

    const testItem = consoleLog.taskId
      ? this.testTree.getTestItemByTaskId(consoleLog.taskId)
      : undefined

    fileMap.get(line)!.push({
      content: consoleLog.content,
      time: consoleLog.time,
      testItem,
    })

    // Update decorations for all visible editors showing this file
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (editor.document.uri.fsPath === file) {
        this.updateDecorations(editor)
      }
    })
  }

  clear(): void {
    this.consoleLogsByFile.clear()
    // Update all visible editors
    vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor))
  }

  clearFile(file: string): void {
    this.consoleLogsByFile.delete(file)
    // Update all visible editors showing this file
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (editor.document.uri.fsPath === file) {
        this.updateDecorations(editor)
      }
    })
  }

  private updateDecorations(editor: vscode.TextEditor): void {
    const config = getConfig()
    if (!config.showInlineConsoleLog) {
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

      const hoverMessage = entries.map((e) => {
        const md = new vscode.MarkdownString()
        if (e.testItem) {
          md.supportHtml = true
          const line = (e.testItem.range?.start.line ?? 0) + 1
          md.appendMarkdown(`<sub>[${createTestLabel(e.testItem)}](${e.testItem.uri?.with({ fragment: `L${line}` })})</sub>`)
          md.appendText('\n')
        }
        return md.appendText(e.content)
      })

      const lineRange = editor.document.lineAt(line).range
      const decoration: vscode.DecorationOptions = {
        range: lineRange,
        hoverMessage,
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
    // Strip ANSI control characters using Node.js util
    const stripped = stripVTControlCharacters(content)
    // Remove trailing newlines and limit length
    const cleaned = stripped.trim().replace(/\n/g, ' ')
    const maxLength = 100
    if (cleaned.length > maxLength) {
      return `${cleaned.substring(0, maxLength)}...`
    }
    return cleaned
  }

  private refresh(): void {
    // Update all visible editors
    vscode.window.visibleTextEditors.forEach(editor => this.updateDecorations(editor))
  }
}

function createTestLabel(testItem: vscode.TestItem, label = testItem.label) {
  if (testItem.parent) {
    return createTestLabel(testItem.parent, `${testItem.parent.label} > ${label}`)
  }
  return label
}
