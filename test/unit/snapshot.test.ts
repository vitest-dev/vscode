import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'chai'
import ts from 'typescript'
import {
  findSnapshotEntry,
  parseSnapshotEntries,
} from '../../packages/extension/src/snapshot/parseSnapshotFile'
import { resolveSnapshotCall } from '../../packages/extension/src/snapshot/resolveSnapshotCall'
import { resolveSnapshotPath } from '../../packages/extension/src/snapshot/resolveSnapshotPath'

const fixtureDir = join(__dirname, 'fixtures', 'snapshot')
const testFile = join(fixtureDir, 'basic.spec.ts')
const sourceText = readFileSync(testFile, 'utf8')
const snapshotText = readFileSync(
  join(fixtureDir, '__snapshots__', 'basic.spec.ts.snap'),
  'utf8',
).replace(/\r\n/g, '\n')
const sourceFile = ts.createSourceFile(
  testFile,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
const snapshotEntries = parseSnapshotEntries(snapshotText)

/** Character offset in the middle of the nth (1-based) occurrence of `needle`. */
function offsetOf(needle: string, occurrence = 1): number {
  let index = -1
  for (let i = 0; i < occurrence; i++) {
    index = sourceText.indexOf(needle, index + 1)
    if (index === -1) throw new Error(`not found: ${needle} #${occurrence}`)
  }
  return index + Math.floor(needle.length / 2)
}

function keyAt(needle: string, occurrence = 1): string | undefined {
  return resolveSnapshotCall(ts, sourceFile, offsetOf(needle, occurrence))?.key
}

/** Resolve the key at the middle of the nth (1-based) `needle` in a synthetic source. */
function keyInSource(source: string, needle: string, occurrence = 1): string | undefined {
  const file = ts.createSourceFile(
    'inline.spec.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  let index = -1
  for (let i = 0; i < occurrence; i++) {
    index = source.indexOf(needle, index + 1)
    if (index === -1) throw new Error(`not found: ${needle} #${occurrence}`)
  }
  return resolveSnapshotCall(ts, file, index + Math.floor(needle.length / 2))?.key
}

describe('resolveSnapshotCall', () => {
  it('builds nested describe > it keys with per-test counters', () => {
    expect(keyAt('toMatchSnapshot', 1)).to.equal('Outer > Inner > does a thing 1')
    expect(keyAt('toMatchSnapshot', 2)).to.equal('Outer > Inner > does a thing 3')
  })

  it('appends the hint and counts hinted calls separately', () => {
    expect(keyAt('toMatchSnapshot', 3)).to.equal('Outer > Inner > does a thing > second 1')
  })

  it('keeps the no-hint counter independent from hinted calls', () => {
    expect(keyAt('toThrowErrorMatchingSnapshot', 1)).to.equal('Outer > Inner > does a thing 4')
  })

  it('ignores property matchers for the key', () => {
    expect(keyAt('toMatchSnapshot', 4)).to.equal('Outer > top level it 1')
  })

  it('supports top-level it', () => {
    expect(keyAt('toMatchSnapshot', 5)).to.equal('no describe 1')
  })

  it('supports it.only', () => {
    expect(keyAt('toMatchSnapshot', 6)).to.equal('modified block 1')
  })

  it('handles backticks inside the test title', () => {
    expect(keyAt('toMatchSnapshot', 7)).to.equal('handles `code` in title 1')
  })

  it('returns undefined for dynamic it.each titles', () => {
    expect(keyAt('toMatchSnapshot', 8)).to.equal(undefined)
  })

  it('returns undefined away from a matcher', () => {
    expect(resolveSnapshotCall(ts, sourceFile, sourceText.indexOf('describe'))).to.equal(undefined)
  })
})

describe('resolveSnapshotCall matcher counters', () => {
  it('counts a preceding inline snapshot toward the external index', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('mixed', () => {`,
      `  expect('a').toMatchSnapshot()`,
      `  expect('b').toMatchInlineSnapshot(\`"b"\`)`,
      `  expect('c').toMatchSnapshot()`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot', 2)).to.equal('mixed 3')
  })

  it('counts a preceding file snapshot toward the external index', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('file', () => {`,
      `  expect('a').toMatchFileSnapshot('./a.txt')`,
      `  expect('b').toMatchSnapshot()`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('file 2')
  })

  it('counts a preceding inline throw snapshot toward the external index', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('throwing', () => {`,
      `  expect(() => { throw new Error('x') }).toThrowErrorMatchingInlineSnapshot()`,
      `  expect('b').toMatchSnapshot()`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('throwing 2')
  })

  it('treats a string first argument of toMatchInlineSnapshot as the snapshot, not a hint', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('snap', () => {`,
      `  expect('a').toMatchInlineSnapshot(\`"a"\`, 'hint')`,
      `  expect('b').toMatchSnapshot('hint')`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('snap > hint 2')
  })

  it('does not count an inline snapshot that uses a different hint', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('diff', () => {`,
      `  expect('a').toMatchInlineSnapshot(\`"a"\`, 'other')`,
      `  expect('b').toMatchSnapshot()`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('diff 1')
  })

  it('counts property matchers with an explicit hint separately', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('props', () => {`,
      `  expect({ a: 1 }).toMatchSnapshot({ a: expect.any(Number) }, 'hint')`,
      `  expect({ a: 2 }).toMatchSnapshot({ a: expect.any(Number) }, 'hint')`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot', 2)).to.equal('props > hint 2')
  })

  it('bails out when a preceding snapshot uses a dynamic hint', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('dynamic', (hint: string) => {`,
      `  expect('a').toMatchSnapshot(hint)`,
      `  expect('b').toMatchSnapshot()`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot', 2)).to.equal(undefined)
  })

  it('recognizes test.describe as a suite', () => {
    const source = [
      `import { expect, test } from 'vitest'`,
      `test.describe('Outer', () => {`,
      `  test('inner', () => {`,
      `    expect('a').toMatchSnapshot()`,
      `  })`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('Outer > inner 1')
  })

  it('recognizes suite as a describe alias', () => {
    const source = [
      `import { expect, suite, test } from 'vitest'`,
      `suite('Outer', () => {`,
      `  test('inner', () => {`,
      `    expect('a').toMatchSnapshot()`,
      `  })`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toMatchSnapshot')).to.equal('Outer > inner 1')
  })

  it('reads the hint argument of toThrowErrorMatchingSnapshot', () => {
    const source = [
      `import { expect, it } from 'vitest'`,
      `it('throwing', () => {`,
      `  expect(() => { throw new Error('x') }).toThrowErrorMatchingSnapshot('hint')`,
      `})`,
    ].join('\n')
    expect(keyInSource(source, 'toThrowErrorMatchingSnapshot')).to.equal('throwing > hint 1')
  })
})

describe('parseSnapshotEntries', () => {
  it('parses every exports block in order', () => {
    expect(snapshotEntries.map((entry) => entry.name)).to.eql([
      'Outer > Inner > does a thing 1',
      'Outer > Inner > does a thing 3',
      'Outer > Inner > does a thing 4',
      'Outer > Inner > does a thing > second 1',
      'Outer > top level it 1',
      'handles `code` in title 1',
      'modified block 1',
      'no describe 1',
    ])
  })

  it('reverses escaping in keys and bodies', () => {
    const entry = findSnapshotEntry(snapshotEntries, 'handles `code` in title 1')
    expect(entry?.body).to.equal('"0"')
  })

  it('extracts multiline bodies without surrounding backticks', () => {
    const entry = findSnapshotEntry(snapshotEntries, 'Outer > top level it 1')
    expect(entry?.body).to.equal('{\n  "a": Any<Number>,\n}')
  })

  it('offsets point at the matching statement', () => {
    const entry = findSnapshotEntry(snapshotEntries, 'no describe 1')!
    expect(snapshotText.slice(entry.start, entry.end)).to.equal('exports[`no describe 1`] = `"x"`;')
  })
})

describe('resolveSnapshotPath', () => {
  it('uses __snapshots__/<basename>.snap by default', () => {
    expect(resolveSnapshotPath('/a/b/foo.spec.ts')).to.equal('/a/b/__snapshots__/foo.spec.ts.snap')
  })

  it('honors a custom snapshot dir', () => {
    expect(resolveSnapshotPath('/a/b/foo.spec.ts', '__snaps__')).to.equal(
      '/a/b/__snaps__/foo.spec.ts.snap',
    )
  })
})

describe('resolve snapshot end to end', () => {
  it('resolves the cursor to the stored snapshot value', () => {
    const key = keyAt('toMatchSnapshot', 2)
    const entry = key ? findSnapshotEntry(snapshotEntries, key) : undefined
    expect(entry?.body).to.equal('"3"')
  })
})
