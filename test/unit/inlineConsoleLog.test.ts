import type { ExtensionUserConsoleLog } from 'vitest-vscode-shared'
import { expect } from 'chai'
import { InlineConsoleLogManager } from '../../packages/extension/src/inlineConsoleLog'

describe('InlineConsoleLogManager', () => {
  it('uses pre-parsed location from worker', () => {
    const manager = new InlineConsoleLogManager()
    const log: ExtensionUserConsoleLog = {
      content: 'test message',
      origin: '    at Object.<anonymous> (/path/to/file.ts:10:5)',
      type: 'stdout',
      taskId: 'test-id',
      time: Date.now(),
      size: 12,
      parsedLocation: {
        file: '/path/to/file.ts',
        line: 9, // 0-based
        column: 5,
      },
    }

    // The manager should use parsedLocation directly
    manager.addConsoleLog(log)

    manager.dispose()
  })

  it('skips console logs without parsed location', () => {
    const manager = new InlineConsoleLogManager()
    const log: ExtensionUserConsoleLog = {
      content: 'test message',
      origin: 'some invalid stack trace',
      type: 'stdout',
      taskId: 'test-id',
      time: Date.now(),
      size: 12,
      // No parsedLocation
    }

    // Should not throw, just skip
    manager.addConsoleLog(log)

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
