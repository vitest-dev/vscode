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
      let latestDocumentSymbols: vscode.DocumentSymbol | undefined = documentSymbols.at(-1)

      if (!latestDocumentSymbols || latestDocumentSymbols.name !== entry.breadcrumb[0]) {
        latestDocumentSymbols = createSnapshotSymbol(entry.breadcrumb[0], entry, 0)
        documentSymbols.push(latestDocumentSymbols)
        entry.breadcrumb.length > 1 && pushToDocumentSymbol(latestDocumentSymbols, entry)
        continue forExportsSymbol
      }

      // Round
      let parent: vscode.DocumentSymbol | undefined
      for (let i = 1; i < entry.breadcrumb.length; i++) {
        parent = latestDocumentSymbols
        latestDocumentSymbols = latestDocumentSymbols.children.at(-1)
        if (!latestDocumentSymbols || latestDocumentSymbols.name !== entry.breadcrumb[i]) {
          latestDocumentSymbols = createSnapshotSymbol(entry.breadcrumb[i], entry, i)
          parent.children.push(latestDocumentSymbols)
          entry.breadcrumb.length !== i && pushToDocumentSymbol(latestDocumentSymbols, entry, i + 1)
          continue forExportsSymbol
        }
      }
      // last level - all breadcrumbs matched, create duplicate leaf
      ;(parent?.children || documentSymbols).push(
        createSnapshotSymbol(entry.breadcrumb.at(-1)!, entry, entry.breadcrumb.length - 1),
      )
    }
    return (this.latestDocumentSymbols = documentSymbols)
  }
}
