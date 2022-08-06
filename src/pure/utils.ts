import type {
  SpawnOptionsWithStdioTuple,
  StdioNull,
  StdioPipe,
} from 'child_process'
import {
  spawn,
} from 'child_process'
import * as path from 'path'
import { chunksToLinesAsync } from '@rauschma/stringio'
import { existsSync } from 'fs-extra'
import { isWindows } from './platform'

export function getVitestPath(projectRoot: string): string | undefined {
  const node_modules = path.resolve(projectRoot, 'node_modules')
  if (!existsSync(node_modules))
    return

  if (existsSync(path.resolve(node_modules, 'vitest', 'vitest.mjs')))
    return sanitizeFilePath(path.resolve(node_modules, 'vitest', 'vitest.mjs'))

  const suffixes = ['.js', '', '.cmd']
  for (const suffix of suffixes) {
    if (existsSync(path.resolve(node_modules, '.bin', `vitest${suffix}`))) {
      return sanitizeFilePath(
        path.resolve(node_modules, '.bin', `vitest${suffix}`),
      )
    }
  }
}

/**
 * if this function return a cmd, then this project is definitely using vitest
 * @param projectRoot
 * @returns
 */
export function getVitestCommand(
  projectRoot: string,
): { cmd: string; args: string[] } | undefined {
  if (!projectRoot || projectRoot.length < 5)
    return

  const node_modules = path.resolve(projectRoot, 'node_modules')
  try {
    if (!existsSync(node_modules))
      return getVitestCommand(path.dirname(projectRoot))

    const suffixes = ['']
    if (isWindows)
      suffixes.unshift('.cmd', '.CMD')

    for (const suffix of suffixes) {
      if (existsSync(path.resolve(node_modules, '.bin', `vitest${suffix}`))) {
        return {
          cmd: path.resolve(node_modules, '.bin', `vitest${suffix}`),
          args: [],
        }
      }
    }

    if (existsSync(path.resolve(node_modules, 'vitest', 'vitest.mjs'))) {
      return {
        cmd: 'node',
        args: [
          sanitizeFilePath(path.resolve(node_modules, 'vitest', 'vitest.mjs')),
        ],
      }
    }

    return getVitestCommand(path.dirname(projectRoot))
  }
  catch (e) {
    console.error(e)
  }
}

export interface Cmd {
  cmd: string
  args: string[]
}

export async function getVitestVersion(
  vitestCommand?: Cmd,
  env?: Record<string, string>,
): Promise<string> {
  let child
  if (vitestCommand == null) {
    child = spawn('npx', ['vitest', '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
  }
  else {
    child = spawn(vitestCommand.cmd, [...vitestCommand.args, '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
  }

  // eslint-disable-next-line no-unreachable-loop
  for await (const line of chunksToLinesAsync(child.stdout)) {
    child.kill()
    return line.match(/vitest\/(\d+.\d+.\d+)/)![1]
  }

  throw new Error(`Cannot get vitest version from "${JSON.stringify(vitestCommand)}"`)
}

export function isNodeAvailable(

  env?: Record<string, string>,

): Promise<boolean> {
  const child = spawn('node', {
    env: { ...process.env, ...env },
  })

  return new Promise((resolve) => {
    child.on('error', () => resolve(false))
    setTimeout(() => {
      resolve(true)
      child.kill()
    }, 1000)
  })
}

const capitalizeFirstLetter = (string: string) =>
  string.charAt(0).toUpperCase() + string.slice(1)

const replaceDoubleSlashes = (string: string) => string.replace(/\\/g, '/')

export function sanitizeFilePath(path: string) {
  if (isWindows)
    return capitalizeFirstLetter(replaceDoubleSlashes(path))

  return path
}

export function filterColorFormatOutput(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001B\[\d+m/g, '')
}

export function execWithLog(
  command: string,
  args: string[],
  options: Partial<SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>> =
  {},
  log?: (s: string) => void,
  error?: (s: string) => void,
) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    // https://nodejs.org/api/child_process.html#child_process_options_detached
    detached: process.platform !== 'win32',
    ...options,
  })

  const promise = Promise.allSettled([
    (async () => {
      for await (
        const line of chunksToLinesAsync(child.stdout)
      ) {
        if (log)
          log(line)
      }
    })(),
    (async () => {
      for await (
        const line of chunksToLinesAsync(child.stderr)
      ) {
        if (error)
          error(line)
      }
    })(),
  ])

  return { child, promise }
}

export function stringToCmd(cmdStr: string): Cmd {
  const list = cmdStr.split(' ')
  return {
    cmd: list[0],
    args: list.slice(1),
  }
}

export function negate(func: Function): (...args: typeof func.arguments) => Boolean {
  return (...args: typeof func.arguments) => !func(...args)
}
