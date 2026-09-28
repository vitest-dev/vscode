/**
 * Parsing helpers for Vitest/Jest `.snap` files.
 *
 * Vitest writes snapshots as `exports[`<key>`] = `<value>`;` where backticks,
 * backslashes and `${` inside the key/value are escaped. These helpers are
 * `vscode`-free so they can be unit tested.
 */

const ValueStart = '= `'

export interface ParsedSnapshotEntry {
  /** Snapshot key with Vitest's escaping reversed. */
  name: string
  /** Serialized snapshot value with Vitest's escaping reversed. */
  body: string
  /** Offset of `exports[`. */
  start: number
  /** Offset just past the closing `;`. */
  end: number
  /** Offset range of the raw key (between the backticks). */
  keyStart: number
  keyEnd: number
  /** Offset range of the raw value (between the backticks). */
  bodyStart: number
  bodyEnd: number
}

/** Reverse Vitest's `printBacktickString` escaping. */
function unescapeSnapshot(value: string): string {
  return value.replace(/\\(`|\\|\$\{)/g, '$1')
}

/** Reverse Vitest's `addExtraLineBreaks` padding around multiline snapshots. */
function stripExtraLineBreaks(value: string): string {
  return value.length > 2 && value[0] === '\n' && value.endsWith('\n') ? value.slice(1, -1) : value
}

/** Offset of the closing backtick of a backtick string starting at `start`, or -1. */
function findValueEnd(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '`') return index
    index += 1
  }
  return -1
}

/**
 * Parse every `exports[`key`] = `value`;` block out of a `.snap` file.
 * Returns character offsets so callers can map them back to editor ranges.
 */
export function parseSnapshotEntries(text: string): ParsedSnapshotEntry[] {
  const entries: ParsedSnapshotEntry[] = []
  const exportRegex = /^exports\[`((?:\\.|[^`\\])*)`\]/gm
  let match: RegExpExecArray | null
  while ((match = exportRegex.exec(text))) {
    const start = match.index
    const rawKey = match[1]
    const keyStart = start + 'exports[`'.length
    const keyEnd = keyStart + rawKey.length

    const valueStart = text.indexOf(ValueStart, keyEnd)
    if (valueStart === -1) continue
    const bodyStart = valueStart + ValueStart.length

    const bodyEnd = findValueEnd(text, bodyStart)
    if (bodyEnd === -1) continue
    const end = text[bodyEnd + 1] === ';' ? bodyEnd + 2 : bodyEnd + 1

    entries.push({
      name: unescapeSnapshot(rawKey),
      body: stripExtraLineBreaks(unescapeSnapshot(text.slice(bodyStart, bodyEnd))),
      start,
      end,
      keyStart,
      keyEnd,
      bodyStart,
      bodyEnd,
    })

    exportRegex.lastIndex = end
  }
  return entries
}

export function findSnapshotEntry(
  entries: ParsedSnapshotEntry[],
  key: string,
): ParsedSnapshotEntry | undefined {
  return entries.find((entry) => entry.name === key)
}
