import * as vscode from 'vscode'
import { loadWorkspaceTypescript } from './loadTypescript'
import { resolveSnapshotCall } from './resolveSnapshotCall'
import { resolveSnapshotPath } from './resolveSnapshotPath'
import type { SnapshotEntry, SnapshotEntryTool } from './tools'
import type { Ts } from './types'

export interface ResolvedSnapshot {
  key: string
  matcher: string
  /** Range of the matcher identifier in the test file. */
  nameRange: vscode.Range
  snapshotDocument: vscode.TextDocument
  entry: SnapshotEntry
}

function scriptKindFor(ts: Ts, languageId: string) {
  switch (languageId) {
    case 'typescriptreact':
      return ts.ScriptKind.TSX
    case 'javascriptreact':
      return ts.ScriptKind.JSX
    case 'javascript':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

/**
 * Resolve the snapshot referenced by the assertion at `position`: load the
 * workspace TypeScript, compute the Vitest key, open the `.snap` file and find
 * the matching entry. Returns `undefined` on any unsupported/missing case.
 */
export async function resolveSnapshotAt(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  snapshotEntryTool: SnapshotEntryTool,
): Promise<ResolvedSnapshot | undefined> {
  if (document.uri.scheme !== 'file') return undefined

  const ts = loadWorkspaceTypescript(document.uri.fsPath)
  if (!ts) return undefined

  const sourceFile = ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(ts, document.languageId),
  )
  const call = resolveSnapshotCall(ts, sourceFile, document.offsetAt(position))
  if (!call) return undefined

  const snapshotPath = resolveSnapshotPath(document.uri.fsPath)
  let snapshotDocument: vscode.TextDocument
  try {
    snapshotDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(snapshotPath))
  } catch {
    return undefined
  }
  if (token.isCancellationRequested) return undefined

  snapshotEntryTool.process(
    snapshotDocument,
    snapshotDocument.uri.toString(),
    snapshotDocument.version,
    token,
  )
  if (token.isCancellationRequested) return undefined

  const entry = snapshotEntryTool.snapshotEntries.find((candidate) => candidate.name === call.key)
  if (!entry) return undefined

  return {
    key: call.key,
    matcher: call.matcher,
    nameRange: new vscode.Range(
      document.positionAt(call.nameStart),
      document.positionAt(call.nameEnd),
    ),
    snapshotDocument,
    entry,
  }
}
