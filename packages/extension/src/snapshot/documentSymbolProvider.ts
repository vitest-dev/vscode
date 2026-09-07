import * as vscode from 'vscode'
import { createSnapshotSymbol, pushToDocumentSymbol, type SnapshotEntryTool } from './tools'

export class SnapshotDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  private latestUri: string | undefined = undefined
  private latestVersion: number | undefined = undefined
  latestDocumentSymbols: vscode.DocumentSymbol[] = []
  constructor(private snapshotEntryTool: SnapshotEntryTool) {}
  provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (this.latestUri === document.uri.toString() && this.latestVersion === document.version) {
      return this.latestDocumentSymbols
    }
    this.snapshotEntryTool.process(document, document.uri.toString(), document.version, token)
    if (token.isCancellationRequested) return null // cancelled

    this.latestUri = document.uri.toString()
    this.latestVersion = document.version

    const documentSymbols: vscode.DocumentSymbol[] = []
    forExportsSymbol: for (const entry of this.snapshotEntryTool.snapshotEntries) {
      let currentLevel: vscode.DocumentSymbol[] = documentSymbols
      let parent: vscode.DocumentSymbol[] | undefined

      for (let i = 0; i < entry.breadcrumb.length; i++) {
        const existingSymbol = currentLevel.at(-1)
        if (!existingSymbol || existingSymbol.name !== entry.breadcrumb[i]) {
          const newSymbol = createSnapshotSymbol(entry.breadcrumb[i], entry, i)
          currentLevel.push(newSymbol)
          i + 1 < entry.breadcrumb.length && pushToDocumentSymbol(newSymbol, entry, i + 1)
          continue forExportsSymbol
        }
        parent = currentLevel
        currentLevel = existingSymbol.children
      }
      // last level - all breadcrumbs matched, create duplicate leaf
      ;(parent || documentSymbols).push(
        createSnapshotSymbol(entry.breadcrumb.at(-1)!, entry, entry.breadcrumb.length - 1),
      )
    }
    return (this.latestDocumentSymbols = documentSymbols)
  }
}
