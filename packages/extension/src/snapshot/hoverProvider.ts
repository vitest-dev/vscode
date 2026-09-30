import * as vscode from 'vscode'
import { getConfig } from '../config'
import { ExternalMatcherPattern } from './matchers'
import { resolveSnapshotAt } from './resolveSnapshotAt'
import type { SnapshotEntryTool } from './tools'

const MaxPreviewLength = 8 * 1024

/** Length of the longest run of backticks in `text` (0 when there are none). */
function longestBacktickRun(text: string): number {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return longest
}

/** Build a fenced code block whose fence cannot be closed by the content. */
function codeBlock(content: string): string {
  const fence = '`'.repeat(Math.max(2, longestBacktickRun(content)) + 1)
  return `${fence}text\n${content}\n${fence}`
}

/** Wrap `text` as a Markdown code span that tolerates backticks in the text. */
function inlineCode(text: string): string {
  const fence = '`'.repeat(longestBacktickRun(text) + 1)
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${padding}${text}${padding}${fence}`
}

function previewBody(body: string): string {
  if (body.length <= MaxPreviewLength) return body
  return `${body.slice(0, MaxPreviewLength)}\n…`
}

/**
 * Show the stored snapshot value when hovering a `toMatchSnapshot` /
 * `toThrowErrorMatchingSnapshot` call. Falls back to the default hover when the
 * snapshot cannot be resolved.
 */
export class SnapshotHoverProvider implements vscode.HoverProvider {
  constructor(private snapshotEntryTool: SnapshotEntryTool) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!getConfig(workspaceFolder).showSnapshotPreview) return undefined
    if (!document.getWordRangeAtPosition(position, ExternalMatcherPattern)) return undefined

    const resolved = await resolveSnapshotAt(document, position, token, this.snapshotEntryTool)
    if (!resolved || token.isCancellationRequested) return undefined

    const markdown = new vscode.MarkdownString()
    markdown.appendMarkdown(`**Vitest snapshot** ${inlineCode(resolved.key)}\n\n`)
    markdown.appendMarkdown(codeBlock(previewBody(resolved.entry.body)))
    markdown.isTrusted = false
    return new vscode.Hover(markdown, resolved.nameRange)
  }
}
