import * as vscode from 'vscode'
import { getConfig } from '../config'
import { ExternalMatcherPattern } from './matchers'
import { resolveSnapshotAt } from './resolveSnapshotAt'
import type { SnapshotEntryTool } from './tools'

/**
 * Go to definition (Ctrl/Cmd+click) on a `toMatchSnapshot` /
 * `toThrowErrorMatchingSnapshot` call opens the matching entry in the `.snap`
 * file. Falls back to the default definition when the snapshot cannot be resolved.
 */
export class SnapshotDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private snapshotEntryTool: SnapshotEntryTool) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!getConfig(workspaceFolder).showSnapshotPreview) return undefined
    if (!document.getWordRangeAtPosition(position, ExternalMatcherPattern)) return undefined

    const resolved = await resolveSnapshotAt(document, position, token, this.snapshotEntryTool)
    if (!resolved || token.isCancellationRequested) return undefined

    return new vscode.Location(resolved.snapshotDocument.uri, resolved.entry.bodyRange)
  }
}
