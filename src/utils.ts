import fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as vscode from 'vscode'
import which from 'which'
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

export function debounce<T extends Function>(cb: T, wait = 20) {
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

let pathToNodeJS: string | undefined

// based on https://github.com/microsoft/playwright-vscode/blob/main/src/utils.ts#L144
export async function findNode(cwd: string): Promise<string> {
  if (pathToNodeJS)
    return pathToNodeJS

  // Stage 1: Try to find Node.js via process.env.PATH
  let node = await which('node').catch(() => undefined)
  // Stage 2: When extension host boots, it does not have the right env set, so we might need to wait.
  for (let i = 0; i < 5 && !node; ++i) {
    await new Promise(f => setTimeout(f, 200))
    node = await which('node').catch(() => undefined)
  }
  // Stage 3: If we still haven't found Node.js, try to find it via a subprocess.
  // This evaluates shell rc/profile files and makes nvm work.
  node ??= await findNodeViaShell(cwd)

  // If volta isn't installed in a Volta folder, this test will fail.
  // If anyone got a better idea for checking volta's presence, please let me know.
  const voltaRegex = /Volta/i

  // Stage 4: We have found Node.js, but it might be managed by Volta.
  // This attempt to ask volta for the path to the node executable.
  if (node && voltaRegex.test(node))
    node = await findNodeUsingVoltaOnWindows(cwd) ?? node

  if (!node)
    throw new Error(`Unable to find 'node' executable.\nMake sure to have Node.js installed and available in your PATH.\nCurrent PATH: '${process.env.PATH}'.`)
  pathToNodeJS = node
  return node
}

function findNodeUsingVoltaOnWindows(cwd: string): Promise<string | undefined> {
  if (process.platform !== 'win32')
    return Promise.resolve(undefined)
  return new Promise<string | undefined>((resolve) => {
    const childProcess = spawn(`volta which node`, {
      stdio: 'pipe',
      shell: true,
      cwd,
    })
    let output = ''
    childProcess.stdout.on('data', data => output += data.toString())
    childProcess.on('error', () => resolve(undefined))
    childProcess.on('exit', (exitCode) => {
      if (exitCode !== 0)
        return resolve(undefined)
      return resolve(output.trim())
    })
  })
}

async function findNodeViaShell(cwd: string): Promise<string | undefined> {
  if (process.platform === 'win32')
    return undefined
  return new Promise<string | undefined>((resolve) => {
    const startToken = '___START_SHELL__'
    const endToken = '___END_SHELL__'
    const childProcess = spawn(`${vscode.env.shell} -i -c 'echo ${startToken} && which node && echo ${endToken}'`, {
      stdio: 'pipe',
      shell: true,
      cwd,
    })
    let output = ''
    childProcess.stdout.on('data', data => output += data.toString())
    childProcess.on('error', () => resolve(undefined))
    childProcess.on('exit', (exitCode) => {
      if (exitCode !== 0)
        return resolve(undefined)
      const start = output.indexOf(startToken)
      const end = output.indexOf(endToken)
      if (start === -1 || end === -1)
        return resolve(undefined)
      return resolve(output.substring(start + startToken.length, end).trim())
    })
  })
}
