import type * as vscode from 'vscode'

/** Languages whose test files can contain `toMatchSnapshot` style assertions. */
export const snapshotTestLanguages: vscode.DocumentSelector = [
  { scheme: 'file', language: 'typescript' },
  { scheme: 'file', language: 'typescriptreact' },
  { scheme: 'file', language: 'javascript' },
  { scheme: 'file', language: 'javascriptreact' },
]
