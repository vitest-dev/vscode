import type { UserConsoleLog } from 'vitest'
import { expect } from 'chai'
import { InlineConsoleLogManager } from '../../packages/extension/src/inlineConsoleLog'

describe('InlineConsoleLogManager', () => {
  it('correctly parses origin with file path', () => {
    const manager = new InlineConsoleLogManager()
    const log: UserConsoleLog = {
      content: 'test message',
      origin: '/path/to/file.ts:10:5',
      type: 'stdout',
      taskId: 'test-id',
      time: Date.now(),
      size: 12,
    }

    // @ts-expect-error accessing private method for testing
    const result = manager.parseOrigin(log.origin)

    expect(result).to.deep.equal({
      file: '/path/to/file.ts',
      line: 9, // 0-based
    })

    manager.dispose()
  })

  it('returns null for invalid origin', () => {
    const manager = new InlineConsoleLogManager()

    // @ts-expect-error accessing private method for testing
    expect(manager.parseOrigin(undefined)).to.be.null
    // @ts-expect-error accessing private method for testing
    expect(manager.parseOrigin('invalid')).to.be.null
    // @ts-expect-error accessing private method for testing
    expect(manager.parseOrigin('/path/to/file.ts')).to.be.null

    manager.dispose()
  })

  it('formats content correctly', () => {
    const manager = new InlineConsoleLogManager()

    // @ts-expect-error accessing private method for testing
    expect(manager.formatContent('test\nmessage')).to.equal('test message')
    // @ts-expect-error accessing private method for testing
    expect(manager.formatContent('  test  ')).to.equal('test')

    // Long content should be truncated
    const longContent = 'a'.repeat(150)
    // @ts-expect-error accessing private method for testing
    const formatted = manager.formatContent(longContent)
    expect(formatted).to.have.lengthOf(103) // 100 + '...'
    expect(formatted.endsWith('...')).to.be.true

    manager.dispose()
  })
})
