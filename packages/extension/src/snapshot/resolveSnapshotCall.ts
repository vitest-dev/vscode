import type { CallExpression, Node, PropertyAccessExpression, SourceFile } from 'typescript'
import { CounterMatchers, ExternalMatchers, type SnapshotMatcher } from './matchers'
import type { Ts } from './types'

export interface SnapshotCallResolution {
  matcher: SnapshotMatcher
  /** Full Vitest snapshot key, e.g. `Outer > Inner > does a thing 1`. */
  key: string
  /** Offset range of the matcher identifier itself. */
  nameStart: number
  nameEnd: number
}

const SuiteNames = new Set(['describe', 'suite'])
const TestNames = new Set(['it', 'test'])
const DynamicModifiers = new Set(['each', 'for'])

/** Sentinel returned when a title/hint cannot be evaluated statically. */
const DYNAMIC = Symbol('dynamic')

interface CalleeInfo {
  base: string
  modifiers: string[]
}

interface MatcherAt {
  call: CallExpression
  matcher: SnapshotMatcher
  nameStart: number
  nameEnd: number
}

function getMatcherName(ts: Ts, call: CallExpression): string | undefined {
  const expression = call.expression
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    if (CounterMatchers.has(expression.name.text)) {
      return expression.name.text
    }
  }
  return undefined
}

/** Resolve the base callee name (`it`, `describe`, ...) and its modifier chain. */
function getCalleeInfo(ts: Ts, call: CallExpression): CalleeInfo | undefined {
  let expression: Node = call.expression
  const modifiers: string[] = []
  // unwrap `test.each([...])('title', fn)` / `test.each`...`(...)`
  while (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression)) {
    expression = ts.isCallExpression(expression) ? expression.expression : expression.tag
  }
  while (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.name)) modifiers.unshift(expression.name.text)
    expression = expression.expression
  }
  if (!ts.isIdentifier(expression)) return undefined
  return { base: expression.text, modifiers }
}

function isDynamicCallee(info: CalleeInfo): boolean {
  return info.modifiers.some((modifier) => DynamicModifiers.has(modifier))
}

/** `describe`/`suite`, plus their `test.describe` / `test.suite` aliases. */
function isSuiteCallee(info: CalleeInfo): boolean {
  return (
    SuiteNames.has(info.base) ||
    (TestNames.has(info.base) && info.modifiers.some((modifier) => SuiteNames.has(modifier)))
  )
}

/** First argument as a plain string, or `undefined` for dynamic/non-string titles. */
function getTitle(ts: Ts, call: CallExpression): string | undefined {
  const first = call.arguments[0]
  if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    return first.text
  }
  return undefined
}

function getLastFunctionArg(ts: Ts, call: CallExpression): Node | undefined {
  const last = call.arguments[call.arguments.length - 1]
  if (last && (ts.isArrowFunction(last) || ts.isFunctionExpression(last))) return last
  return undefined
}

function isNodeWithin(sourceFile: SourceFile, node: Node, container: Node): boolean {
  return (
    node.getStart(sourceFile) >= container.getStart(sourceFile) &&
    node.getEnd() <= container.getEnd()
  )
}

function findEnclosingTest(ts: Ts, sourceFile: SourceFile, node: Node): CallExpression | undefined {
  let current: Node | undefined = node.parent
  while (current) {
    if (ts.isCallExpression(current)) {
      const info = getCalleeInfo(ts, current)
      if (info && TestNames.has(info.base) && !isSuiteCallee(info)) {
        const fn = getLastFunctionArg(ts, current)
        if (fn && isNodeWithin(sourceFile, node, fn)) return current
      }
    }
    current = current.parent
  }
  return undefined
}

function collectSuiteTitles(ts: Ts, testCall: CallExpression): string[] | undefined {
  const titles: string[] = []
  let current: Node | undefined = testCall.parent
  while (current) {
    if (ts.isCallExpression(current)) {
      const info = getCalleeInfo(ts, current)
      if (info && isSuiteCallee(info)) {
        if (isDynamicCallee(info)) return undefined
        const title = getTitle(ts, current)
        if (title === undefined) return undefined
        titles.unshift(title)
      }
    }
    current = current.parent
  }
  return titles
}

function isStringLiteral(ts: Ts, node: Node): node is Node & { text: string } {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

/** Static string value of `node`. `undefined` when absent, or `DYNAMIC` when not a literal. */
function staticString(ts: Ts, node: Node | undefined): string | undefined | typeof DYNAMIC {
  if (!node) return undefined
  return isStringLiteral(ts, node) ? node.text : DYNAMIC
}

/** Extract the snapshot hint (`message`) argument for a matcher call. */
function getHint(
  ts: Ts,
  matcher: string,
  call: CallExpression,
): string | undefined | typeof DYNAMIC {
  const args = call.arguments
  if (matcher === 'toMatchInlineSnapshot') {
    const [properties, inlineSnapshot, message] = args
    // Vitest treats a string first argument as the inline snapshot, not a hint.
    if (properties && isStringLiteral(ts, properties)) return staticString(ts, inlineSnapshot)
    if (properties && ts.isObjectLiteralExpression(properties)) return staticString(ts, message)
    return properties ? DYNAMIC : undefined
  }
  if (matcher === 'toThrowErrorMatchingInlineSnapshot' || matcher === 'toMatchFileSnapshot') {
    return staticString(ts, args[1])
  }
  if (args.length === 0) return undefined
  const last = args[args.length - 1]
  if (isStringLiteral(ts, last)) return last.text
  // `toMatchSnapshot({ ... })` (property matchers) has no hint
  if (matcher === 'toMatchSnapshot' && ts.isObjectLiteralExpression(last)) return undefined
  return DYNAMIC
}

function collectMatcherCalls(ts: Ts, body: Node): { call: CallExpression; matcher: string }[] {
  const found: { call: CallExpression; matcher: string }[] = []
  const visit = (node: Node) => {
    if (ts.isCallExpression(node)) {
      const matcher = getMatcherName(ts, node)
      if (matcher) found.push({ call: node, matcher })
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return found
}

/** External snapshot-matcher call whose matcher name contains `offset`. */
function findMatcherCallAt(ts: Ts, sourceFile: SourceFile, offset: number): MatcherAt | undefined {
  let found: MatcherAt | undefined
  const visit = (node: Node) => {
    if (found) return
    if (ts.isCallExpression(node)) {
      const matcher = getMatcherName(ts, node)
      if (matcher && ExternalMatchers.has(matcher)) {
        const nameNode = (node.expression as PropertyAccessExpression).name
        const nameStart = nameNode.getStart(sourceFile)
        const nameEnd = nameNode.getEnd()
        if (offset >= nameStart && offset <= nameEnd) {
          found = { call: node, matcher: matcher as SnapshotMatcher, nameStart, nameEnd }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/**
 * Resolve the Vitest snapshot key for the `toMatchSnapshot` /
 * `toThrowErrorMatchingSnapshot` call at `offset`.
 *
 * The key format matches `@vitest/snapshot`:
 * `[<suite titles...>, testTitle, ...(hint ? [hint] : [])].join(' > ') + ' ' + index`
 * where `index` counts preceding snapshot assertions with the same title+hint,
 * including inline and file snapshots since those share the same counter.
 *
 * Returns `undefined` when the call is not inside a test or uses dynamic titles/hints.
 */
export function resolveSnapshotCall(
  ts: Ts,
  sourceFile: SourceFile,
  offset: number,
): SnapshotCallResolution | undefined {
  const matcherAt = findMatcherCallAt(ts, sourceFile, offset)
  if (!matcherAt) return undefined

  const testCall = findEnclosingTest(ts, sourceFile, matcherAt.call)
  if (!testCall) return undefined

  const testInfo = getCalleeInfo(ts, testCall)
  const testTitle = getTitle(ts, testCall)
  if (!testInfo || isDynamicCallee(testInfo) || testTitle === undefined) return undefined

  const suiteTitles = collectSuiteTitles(ts, testCall)
  if (!suiteTitles) return undefined

  const hint = getHint(ts, matcherAt.matcher, matcherAt.call)
  if (hint === DYNAMIC) return undefined

  const body = getLastFunctionArg(ts, testCall)
  if (!body) return undefined

  let index = 1
  for (const other of collectMatcherCalls(ts, body)) {
    if (other.call === matcherAt.call) break
    const otherHint = getHint(ts, other.matcher, other.call)
    if (otherHint === DYNAMIC) return undefined // cannot tell if it shares this counter
    if (otherHint === hint) index += 1
  }

  const testName = [...suiteTitles, testTitle, ...(hint !== undefined ? [hint] : [])].join(' > ')
  return {
    matcher: matcherAt.matcher,
    key: `${testName} ${index}`,
    nameStart: matcherAt.nameStart,
    nameEnd: matcherAt.nameEnd,
  }
}
