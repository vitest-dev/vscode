import fs from 'node:fs'
import * as vscode from 'vscode'
import { dirname, relative } from 'pathe'
import type { VitestPackage } from './api/pkg'
import { log } from './log'

export function noop() {}

export function formatPkg(pkg: VitestPackage) {
  return `Vitest v${pkg.version} (${relative(dirname(pkg.cwd), pkg.id)})`
}

export async function createVitestWorkspaceFile(vitest: VitestPackage[]) {
  const folders = new Set(vitest.map(x => x.folder))
  const encoder = new TextEncoder()
  const promises = [...folders].map(async (folder) => {
    const configFiles = vitest.filter(x => x.folder === folder).map(x => relative(folder.uri.fsPath, x.configFile!))
    const ext = configFiles.every(x => /\.m?ts$/.test(x)) ? 'ts' : 'js'
    const workspaceFileUri = vscode.Uri.joinPath(folder.uri, `vitest.workspace.${ext}`)

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

function _showVitestError(message: string, error?: any) {
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

export const showVitestError = debounce(_showVitestError, 100)

export function pluralize(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

export function debounce<T extends (...args: any[]) => void>(cb: T, wait = 20) {
  let h: NodeJS.Timeout | undefined
  const callable = (...args: any) => {
    if (h)
      clearTimeout(h)
    h = setTimeout(() => cb(...args), wait)
  }
  return <T>(<any>callable)
}

// port from nanoid
// https://github.com/ai/nanoid
const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
export function nanoid(size = 21) {
  let id = ''
  let i = size
  while (i--)
    id += urlAlphabet[(Math.random() * 64) | 0]
  return id
}

export function waitUntilExists(file: string, timeoutMs = 5000) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`File ${file} did not appear in time`))
    }, timeoutMs)
    const interval = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(interval)
        clearTimeout(timeout)
        resolve()
      }
    }, 50)
  })
}
