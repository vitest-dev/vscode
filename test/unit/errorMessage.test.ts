import * as vscode from 'vscode'
import { expect } from 'chai'
import type { TestError } from 'vitest'
import { testMessageForTestError } from '../../packages/extension/src/runner'

describe('Error cause diff', () => {
  const controller = vscode.tests.createTestController('error-cause', 'Error cause')
  after(() => controller.dispose())

  it('shows the assertion diff from a cause while retaining the wrapper message', () => {
    const item = controller.createTestItem('test', 'test', vscode.Uri.file('/test.ts'))
    const error = {
      name: 'Error',
      message: 'Property failed after 1 test',
      cause: {
        name: 'AssertionError',
        message: 'expected actual to equal expected',
        actual: 'actual',
        expected: 'expected',
      },
    }
    const message = testMessageForTestError(item, error)
    expect(message.actualOutput).to.equal('actual')
    expect(message.expectedOutput).to.equal('expected')
    expect(message.message).to.include('Property failed after 1 test')
    expect(message.message).to.include('Caused by: AssertionError')
  })

  it('prefers the outer diff and preserves its location and copy association', () => {
    const uri = vscode.Uri.file('/test.ts')
    const item = controller.createTestItem('outer', 'outer', uri)
    const error: TestError = {
      name: 'AssertionError',
      message: 'outer assertion',
      actual: 'outer actual',
      expected: 'outer expected',
      stacks: [{ file: uri.fsPath, line: 3, column: 5, method: 'test' }],
      cause: { message: 'inner assertion', actual: 'inner actual', expected: 'inner expected' },
    }
    const message = testMessageForTestError(item, error)
    expect(message.actualOutput).to.equal('outer actual')
    expect(message.expectedOutput).to.equal('outer expected')
    expect(message.location?.uri.fsPath).to.equal(uri.fsPath)
    expect(message.location?.range.start.line).to.equal(2)
    expect(message.location?.range.start.character).to.equal(4)
    expect(message.contextValue).to.equal(error.__vscode_id)
    expect(message.contextValue).to.be.a('string')
    expect(error.cause?.__vscode_id).to.equal(undefined)
  })

  it('uses the nearest cause with a complete diff across multiple wrappers', () => {
    const item = controller.createTestItem('nested', 'nested')
    const error: TestError = {
      message: 'outer',
      cause: {
        message: 'middle',
        actual: 'incomplete',
        cause: {
          message: 'assertion',
          actual: 'nearest actual',
          expected: 'nearest expected',
          cause: { message: 'deeper', actual: 'deeper actual', expected: 'deeper expected' },
        },
      },
    }
    const message = testMessageForTestError(item, error)
    expect(message.actualOutput).to.equal('nearest actual')
    expect(message.expectedOutput).to.equal('nearest expected')
  })

  for (const invalid of [undefined, 'undefined']) {
    for (const field of ['actual', 'expected'] as const) {
      it(`skips ${field} equal to ${String(invalid)} when finding a cause diff`, () => {
        const item = controller.createTestItem(`${field}-${invalid}`, 'test')
        const error: TestError = {
          message: 'outer',
          actual: 'outer actual',
          expected: 'outer expected',
          [field]: invalid,
          cause: { message: 'inner', actual: '', expected: 'expected' },
        }
        const message = testMessageForTestError(item, error)
        expect(message.actualOutput).to.equal('')
        expect(message.expectedOutput).to.equal('expected')
      })
    }
  }

  it('keeps a plain message when no error in the chain has a diff', () => {
    const item = controller.createTestItem('plain', 'plain')
    const message = testMessageForTestError(item, {
      name: 'Error',
      message: 'wrapper',
      cause: { name: 'TypeError', message: 'cause without a diff' },
    })
    expect(message.actualOutput).to.equal(undefined)
    expect(message.expectedOutput).to.equal(undefined)
    expect(message.message).to.include('wrapper')
    expect(message.message).to.include('cause without a diff')
  })

  it('keeps the unknown error fallback', () => {
    const item = controller.createTestItem('unknown', 'unknown')
    expect(testMessageForTestError(item, undefined).message).to.equal('Unknown error')
  })
})
