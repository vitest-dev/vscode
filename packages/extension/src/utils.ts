import type { TestError } from 'vitest'
import type { VitestPackage } from './spawn/pkg'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { inspect, stripVTControlCharacters } from 'node:util'
import { dirname, relative } from 'pathe'
import * as vscode from 'vscode'
import which from 'which'
import { getConfig } from './config'
import { log } from './log'
import { getTestData, TestFile } from './testTreeData'

export function noop() {}

export function formatPkg(pkg: VitestPackage) {
  return `Vitest v${pkg.version} (${relative(dirname(pkg.cwd), pkg.id)})`
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

const pathToRuntime: {
  deno?: string
  node?: string
} = {}

export function clearCachedRuntime() {
  pathToRuntime.deno = undefined
  pathToRuntime.node = undefined
}

// based on https://github.com/microsoft/playwright-vscode/blob/main/src/utils.ts#L144
export async function findRuntimeExecutable(runtime: 'node' | 'deno', cwd: string): Promise<string> {
  if (getConfig().nodeExecutable)
    // if empty string, keep as undefined
    pathToRuntime[runtime] = getConfig().nodeExecutable || undefined

  if (pathToRuntime[runtime])
    return pathToRuntime[runtime]

  // Stage 1: Try to find Node.js via process.env.PATH
  let node: string | null = await which(runtime, { nothrow: true })
  // Stage 2: When extension host boots, it does not have the right env set, so we might need to wait.
  for (let i = 0; i < 5 && !node; ++i) {
    await new Promise(f => setTimeout(f, 200))
    node = await which(runtime, { nothrow: true })
  }
  // Stage 3: If we still haven't found Node.js, try to find it via a subprocess.
  // This evaluates shell rc/profile files and makes nvm work.
  node ??= await findRuntimeViaShell(runtime, cwd)

  if (!node) {
    const msg = `Unable to find 'node' executable.\nMake sure to have Node.js installed and available in your PATH.\nCurrent PATH: '${process.env.PATH}'.`
    log.error(msg)
    throw new Error(msg)
  }
  pathToRuntime[runtime] = node
  return node
}

async function findRuntimeViaShell(runtime: 'node' | 'deno', cwd: string): Promise<string | null> {
  if (process.platform === 'win32')
    return null
  return new Promise<string | null>((resolve) => {
    const startToken = '___START_SHELL__'
    const endToken = '___END_SHELL__'
    try {
      const childProcess = spawn(`${vscode.env.shell} -i -c 'if [[ $(type ${runtime} 2>/dev/null) == *function* ]]; then ${runtime} --version; fi; echo ${startToken} && which ${runtime} && echo ${endToken}'`, {
        stdio: 'pipe',
        shell: true,
        cwd,
      })
      let output = ''
      childProcess.stdout.on('data', data => output += data.toString())
      childProcess.on('error', () => resolve(null))
      childProcess.on('exit', (exitCode) => {
        if (exitCode !== 0)
          return resolve(null)
        const start = output.indexOf(startToken)
        const end = output.indexOf(endToken)
        if (start === -1 || end === -1)
          return resolve(null)
        return resolve(output.substring(start + startToken.length, end).trim())
      })
    }
    catch (e) {
      log.error('[SPAWN]', vscode.env.shell, e)
      resolve(null)
    }
  })
}

export function getErrorMessage(error: TestError) {
  let message = ''
  if (error.name) {
    message += `${error.name}: `
  }
  message += stripVTControlCharacters(error.message ?? '')
  if (typeof error.frame === 'string') {
    message += `\n${error.frame}`
  }
  else {
    const errorProperties = getErrorProperties(error)
    if (Object.keys(errorProperties).length) {
      const errorsInspect = inspect(errorProperties, {
        showHidden: false,
        colors: false,
      })
      message += `\nSerialized Error: ${errorsInspect.slice('[Object: null prototype] '.length)}`
    }
  }

  if (typeof error.cause === 'object' && error.cause && 'name' in error.cause) {
    if (!error.cause.name?.includes('Caused by')) {
      error.cause.name = `Caused by: ${error.cause.name}`
    }
    message += `\n\n${getErrorMessage(error.cause)}`
  }

  return message
}

const skipErrorProperties = new Set([
  'nameStr',
  'stack',
  'cause',
  'stacks',
  'stackStr',
  'type',
  'showDiff',
  'ok',
  '__vscode_id',
  'operator',
  'diff',
  'codeFrame',
  'actual',
  'expected',
  'diffOptions',
  'sourceURL',
  'column',
  'line',
  'VITEST_TEST_NAME',
  'VITEST_TEST_PATH',
  'VITEST_AFTER_ENV_TEARDOWN',
  ...Object.getOwnPropertyNames(Error.prototype),
  ...Object.getOwnPropertyNames(Object.prototype),
])

function getErrorProperties(e: TestError) {
  const errorObject = Object.create(null)
  if (e.name === 'AssertionError') {
    return errorObject
  }

  for (const key of Object.getOwnPropertyNames(e)) {
    if (!skipErrorProperties.has(key)) {
      errorObject[key] = e[key as keyof TestError]
    }
  }

  return errorObject
}

export function createTestLabel(testItem: vscode.TestItem, label = testItem.label) {
  const data = getTestData(testItem)
  if (data instanceof TestFile) {
    return label
  }
  if (testItem.parent) {
    return createTestLabel(testItem.parent, `${testItem.parent.label} > ${label}`)
  }
  return label
}
