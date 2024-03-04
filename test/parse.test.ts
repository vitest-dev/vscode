import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect } from 'chai'
import parse from '../src/pure/parsers'

describe('parse', () => {
  function load(filename: string) {
    const filepath = path.join(__dirname, `./testdata/parse/${filename}`)
    const data = fs.readFileSync(filepath, 'utf-8')
    return [filename, data] as const
  }
  it('parse', () => {
    const [filename, data] = load('00_simple.ts')
    const out = parse(filename, data)
    expect(out.describeBlocks.length).to.equal(1)
    expect(out.itBlocks.length).to.equal(1)
  })

  it('parse skipIf with concurrent #36', () => {
    const [filename, data] = load('01_skipif.ts')
    const out = parse(filename, data)
    expect(out.describeBlocks.length).to.equal(1)
  })

  it('parse each', () => {
    const [filename, data] = load('02_each.ts')
    const out = parse(filename, data)
    expect(out.itBlocks.length).to.equal(1)
    expect(out.itBlocks[0].lastProperty).to.equal('each')
  })

  it('parse decorator', () => {
    const [filename, data] = load('03_decorator.ts')
    const out = parse(filename, data)
    expect(out.describeBlocks.length).to.equal(1)
  })

  it('parse using keyword', () => {
    const [filename, data] = load('04_using_keyword.ts')
    const out = parse(filename, data)
    expect(out.describeBlocks.length).to.equal(1)
  })

  it('parse satisfies keyword', () => {
    const [filename, data] = load('05_satisfies_keyword.ts')
    const out = parse(filename, data)
    expect(out.describeBlocks.length).to.equal(1)
  })
})
