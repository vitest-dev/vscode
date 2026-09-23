import { expect } from 'chai'
import {
  createRpcCodec,
  pickRpcCodec,
  v8FormatVersion,
} from '../../packages/extension/src/rpcCodec'

describe('pickRpcCodec', () => {
  it('uses v8 when both sides write the same format', () => {
    expect(pickRpcCodec('node', 15, 15)).to.equal('v8')
  })

  it('falls back to json when the extension host writes a newer format', () => {
    // VS Code 1.139 (Electron, V8 15.0) writes 16; Node 26 (V8 14.6) writes 15 and cannot read it
    expect(pickRpcCodec('node', 16, 15)).to.equal('json')
  })

  it('falls back to json when the worker writes a newer format', () => {
    expect(pickRpcCodec('node', 15, 16)).to.equal('json')
  })

  it('keeps v8 when the extension does not report a format', () => {
    expect(pickRpcCodec('node', undefined, 15)).to.equal('v8')
  })

  it('always uses json outside of node', () => {
    expect(pickRpcCodec('deno', 15, 15)).to.equal('json')
  })
})

describe('createRpcCodec', () => {
  const message = { m: 'getFiles', a: [], i: 'abc', t: 'q' }

  it('round-trips a birpc message through v8', () => {
    const { serialize, deserialize } = createRpcCodec('v8')
    expect(deserialize(serialize(message))).to.deep.equal(message)
  })

  it('round-trips a birpc message through json, including from a Buffer', () => {
    const { serialize, deserialize } = createRpcCodec('json')
    expect(deserialize(serialize(message))).to.deep.equal(message)
    expect(deserialize(Buffer.from(serialize(message)))).to.deep.equal(message)
  })

  it('keeps error details in json', () => {
    const { serialize, deserialize } = createRpcCodec('json')
    const error = deserialize(serialize({ e: new TypeError('boom') })).e
    expect(error).to.include({ name: 'TypeError', message: 'boom' })
    expect(error.stack).to.be.a('string')
  })
})

it('v8FormatVersion reads the header V8 writes', () => {
  expect(v8FormatVersion()).to.be.a('number').and.greaterThan(12)
})
