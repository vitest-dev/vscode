import * as vscode from 'vscode'

const ExportSymbolRegex = /^exports\[`([^`]*)`\]/gm
const RangeEndRegex = /^`;$/m

export interface SnapshotEntry {
  name: string
  breadcrumb: [...describeName: string[], itName: string]
  start: number
  end: number
  fullRange: vscode.Range
  keyRange: vscode.Range
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
    let changeUri = false
    let changeVersion = false
    if (this.latestUri !== uri) {
      this.latestUri = uri
      this.latestVersion = version
      changeUri = true
      changeVersion = true
    } else if (this.latestVersion !== version) {
      this.latestVersion = version
      changeVersion = true
    }

    if (!changeUri && !changeVersion) {
      return // cached
    } else {
      // reset snapshotEntries
      this.snapshotEntries = []
    }
    if (token.isCancellationRequested) return // cancelled
    const text = document.getText()
    const exportsSymbols = text.matchAll(ExportSymbolRegex) || []

    for (const match of exportsSymbols) {
      const name = match[1]
      const snapshotDataStart = match.index
      const snapshotDataEnd =
        (text.slice(snapshotDataStart).match(RangeEndRegex)?.index ??
          /* broken snapshot data */
          'exports[`'.length + name.length + '`]'.length + ' = `'.length) +
        snapshotDataStart +
        '`;'.length

      this.snapshotEntries.push({
        name: name,
        breadcrumb: name.split(' > ') as [...describeName: string[], itName: string],
        start: snapshotDataStart,
        end: snapshotDataEnd,
        fullRange: new vscode.Range(
          document.positionAt(snapshotDataStart),
          document.positionAt(snapshotDataEnd),
        ),
        keyRange: new vscode.Range(
          document.positionAt(snapshotDataStart + 'exports[`'.length),
          document.positionAt(snapshotDataStart + 'exports[`'.length + name.length),
        ),
      })
    }
  }
}

export function createSnapshotSymbol(
  name: string,
  entry: SnapshotEntry,
  index: number,
): vscode.DocumentSymbol {
  const isLast = index === entry.breadcrumb.length - 1
  const isTopLevel = index === 0
  return new vscode.DocumentSymbol(
    name,
    isLast ? (isTopLevel ? 'test' : 'it') : 'describe',
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
