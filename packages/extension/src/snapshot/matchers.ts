export type SnapshotMatcher = 'toMatchSnapshot' | 'toThrowErrorMatchingSnapshot'

/** Matchers that read or write an entry in the external `.snap` file. */
export const ExternalMatchers: ReadonlySet<string> = new Set([
  'toMatchSnapshot',
  'toThrowErrorMatchingSnapshot',
])

/** Pattern matching the external matcher names, for `getWordRangeAtPosition`. */
export const ExternalMatcherPattern = new RegExp(Array.from(ExternalMatchers).join('|'))

/**
 * Matchers that consume Vitest's per-test snapshot counter. Inline and file
 * snapshots are not stored in `.snap`, but they still take a counter slot, so
 * they shift the index of any later external snapshot in the same test.
 */
export const CounterMatchers: ReadonlySet<string> = new Set([
  ...ExternalMatchers,
  'toMatchInlineSnapshot',
  'toThrowErrorMatchingInlineSnapshot',
  'toMatchFileSnapshot',
])
