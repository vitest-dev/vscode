import * as vscode from 'vscode'
import { parseSnapshotEntries } from './parseSnapshotFile'

export interface SnapshotEntry {
  name: string
  breadcrumb: [...describeName: string[], itName: string]
  start: number
  end: number
  body: string
  fullRange: vscode.Range
  keyRange: vscode.Range
  bodyRange: vscode.Range
}

export class SnapshotEntryTool {
  private latestUri: string | undefined = undefined
  private latestVersion: number | undefined = undefined
  snapshotEntries: SnapshotEntry[] = []

  process(
    document: vscode.TextDocument,
    uri: string,
    version: number,
    token: vscode.CancellationToken,
  ): void {
    if (this.latestUri === uri && this.latestVersion === version) {
      return // cached
    }
    if (token.isCancellationRequested) {
      return // cancelled: keep the previous cache untouched
    }

    this.snapshotEntries = parseSnapshotEntries(document.getText()).map((entry) => ({
      name: entry.name,
      breadcrumb: entry.name.split(' > ') as [...describeName: string[], itName: string],
      start: entry.start,
      end: entry.end,
      body: entry.body,
      fullRange: new vscode.Range(document.positionAt(entry.start), document.positionAt(entry.end)),
      keyRange: new vscode.Range(
        document.positionAt(entry.keyStart),
        document.positionAt(entry.keyEnd),
      ),
      bodyRange: new vscode.Range(
        document.positionAt(entry.bodyStart),
        document.positionAt(entry.bodyEnd),
      ),
    }))
    this.latestUri = uri
    this.latestVersion = version
  }
}

export function createSnapshotSymbol(
  name: string,
  entry: SnapshotEntry,
  index: number,
): vscode.DocumentSymbol {
  const isLastRound = index === entry.breadcrumb.length - 1
  return new vscode.DocumentSymbol(
    name,
    isLastRound ? 'it' : 'describe',
    vscode.SymbolKind.Function,
    entry.fullRange,
    entry.keyRange,
  )
}

export function pushToDocumentSymbol(
  parentDocumentSymbol: vscode.DocumentSymbol,
  entry: SnapshotEntry,
  startIndex: number = 1,
): void {
  for (let i = startIndex; i < entry.breadcrumb.length; i++) {
    const newDocumentSymbol = createSnapshotSymbol(entry.breadcrumb[i], entry, i)
    parentDocumentSymbol.children.push(newDocumentSymbol)
    parentDocumentSymbol = newDocumentSymbol
  }
}
