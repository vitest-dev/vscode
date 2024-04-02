import * as vscode from 'vscode'
import { relative } from 'pathe'
import type { VitestPackage } from './api/pkg'
import { log } from './log'

export function noop() {}

export async function createVitestWorkspaceFile(vitest: VitestPackage[]) {
  const folders = new Set(vitest.map(x => x.folder))
  const encoder = new TextEncoder()
  const promises = [...folders].map(async (folder) => {
    const workspaceFileUri = vscode.Uri.joinPath(folder.uri, 'vitest.workspace.js')
    const configFiles = vitest.filter(x => x.folder === folder).map(x => relative(folder.uri.fsPath, x.configFile!))

    const workspaceContent = `
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  ${configFiles.map(file => `"./${file}"`).join(',\n  ')}
])
`.trimStart()

    await vscode.workspace.fs.writeFile(workspaceFileUri, encoder.encode(workspaceContent))
    return await vscode.workspace.openTextDocument(workspaceFileUri)
  })

  const results = await Promise.all(promises)
  if (results[0])
    await vscode.window.showTextDocument(results[0])

  await vscode.window.showInformationMessage('Created vitest.workspace.js. You might need to run \`npm i --save-dev vitest\` in the root folder to install Vitest.')
}

export function showVitestError(message: string, error?: any) {
  if (error)
    log.error(error)

  vscode.window.showErrorMessage(
    `${message}. Check the output for more details.`,
    'See error',
  ).then((result) => {
    if (result === 'See error')
      vscode.commands.executeCommand('vitest.openOutput')
  })
}

export function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}
