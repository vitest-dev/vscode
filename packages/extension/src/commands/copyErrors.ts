import type { TestError } from 'vitest'
import * as vscode from 'vscode'
import { getTestData, TestCase } from '../testTreeData'
import { createTestLabel, getErrorMessage, showVitestError } from '../utils'

export async function copyTestItemErrors(testItem: vscode.TestItem | undefined) {
  if (!testItem) {
    return
  }
  const data = getTestData(testItem)
  if (data instanceof TestCase) {
    const copyText = createTestItemErrors(testItem, data)
    if (copyText != null) {
      await vscode.env.clipboard.writeText(copyText)
    }
    return
  }

  const errors: string[] = []
  const walk = (item: vscode.TestItem) => {
    const data = getTestData(item)
    if (data instanceof TestCase) {
      const message = createTestItemErrors(item, data)
      if (message != null) {
        errors.push(message)
      }
    }
    else if (item.children.size) {
      item.children.forEach(item => walk(item))
    }
  }
  testItem.children.forEach(item => walk(item))
  if (errors.length) {
    await vscode.env.clipboard.writeText(errors.join(`${'='.repeat(80)}\n\n`))
  }
}

function createTestItemErrors(item: vscode.TestItem, test: TestCase) {
  const errors = test.errors?.map(error => createTestErrorMessage(getErrorMessage(error), error))
  if (errors?.length) {
    const errorLabel = createTestItemLabel(item)
    return errorLabel + errors.join(`${'='.repeat(50)}\n\n`)
  }
}

export async function copyErrorOutput(arg1: { test: vscode.TestItem; message: vscode.TestMessage } | undefined) {
  if (!arg1) {
    return
  }
  // The "message" is a different instance from the one the extension creates
  // And it doesn't have stackTraces and other properties assigned to it
  const { test, message } = arg1
  const data = getTestData(test)
  if (!(data instanceof TestCase)) {
    return
  }

  const error = data.errors?.find(e => e.__vscode_id === message.contextValue)
  if (!error) {
    showVitestError('Cannot copy the error output. Please, open an issue with reproduction')
    return
  }

  const errorLabel = createTestItemLabel(test)
  const errorMessage = createTestErrorMessage(message.message.toString(), error)

  await vscode.env.clipboard.writeText(errorLabel + errorMessage)
}

function createTestItemLabel(test: vscode.TestItem) {
  const parts: string[] = []
  parts.push(
    `Test: ${createTestLabel(test)}`,
    `File: ${test.uri}`,
    '',
    '',
  )
  return parts.join('\n')
}

function createTestErrorMessage(message: string, error: TestError) {
  const parts: string[] = []
  parts.push(
    message,
  )

  for (const frame of error.stacks || []) {
    const location = `${frame.file}:${frame.line}:${frame.column}`
    if (frame.method) {
      parts.push(`  at ${frame.method} (${location})`)
    }
    else {
      parts.push(`  at ${location}`)
    }
  }

  return parts.join('\n')
}
