import * as vscode from 'vscode'
import { type SnapshotEntryTool } from './tools'

export class SnapshotFoldingRangeProvider implements vscode.FoldingRangeProvider {
  private latestUri: string | undefined = undefined
  private latestVersion: number | undefined = undefined
  latestFoldingRanges: vscode.FoldingRange[] = []
  constructor(private snapshotEntryTool: SnapshotEntryTool) {}
  provideFoldingRanges(
    document: vscode.TextDocument,
    _: vscode.FoldingContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    if (this.latestUri === document.uri.toString() && this.latestVersion === document.version) {
      return this.latestFoldingRanges
    }
    this.snapshotEntryTool.process(document, document.uri.toString(), document.version, token)
    if (token.isCancellationRequested) return null // cancelled

    this.latestUri = document.uri.toString()
    this.latestVersion = document.version
    const foldingRanges: vscode.FoldingRange[] = []
    for (const symbol of this.snapshotEntryTool.snapshotEntries) {
      foldingRanges.push(
        new vscode.FoldingRange(
          document.positionAt(symbol.start).line,
          document.positionAt(symbol.end).line,
          vscode.FoldingRangeKind.Region,
        ),
      )
    }
    return (this.latestFoldingRanges = foldingRanges)
  }
}
