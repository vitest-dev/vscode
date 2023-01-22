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
    return sanitizeFilePath(path.resolve(node_modules, 'vitest', 'vitest.mjs'), false)

  const suffixes = ['.js', '', '.cmd']
  for (const suffix of suffixes) {
    if (existsSync(path.resolve(node_modules, '.bin', `vitest${suffix}`))) {
      return sanitizeFilePath(
        path.resolve(node_modules, '.bin', `vitest${suffix}`),
        false,
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
          sanitizeFilePath(path.resolve(node_modules, 'vitest', 'vitest.mjs'), false),
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

const spawnVitestVersion = async (
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<string | undefined> => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })

  // eslint-disable-next-line no-unreachable-loop
  for await (const line of chunksToLinesAsync(child.stdout)) {
    child.kill()
    return line.match(/vitest\/(\d+.\d+.\d+)/)![1]
  }
}

const getVersionOrThrow = (vitestCommand: string | undefined): string => {
  if (vitestCommand !== undefined)
    return vitestCommand

  throw new Error(`Cannot get vitest version from "${JSON.stringify(vitestCommand)}"`)
}

export async function getVitestVersion(
  vitestCommand?: Cmd,
  env?: Record<string, string>,
): Promise<string> {
  const envs = { ...process.env, ...env }

  if (vitestCommand == null)
    return getVersionOrThrow(await spawnVitestVersion('npx', ['vitest', '-v'], envs))

  const version = getVersionOrThrow(await spawnVitestVersion(vitestCommand.cmd, [...vitestCommand.args, '-v'], envs))

  if (version !== undefined)
    return version

  // When using a Node installed by a version manager, we need to pass the execPath to spawn
  return getVersionOrThrow(await spawnVitestVersion(process.execPath, [vitestCommand.cmd, ...vitestCommand.args, '-v'], envs))
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

const removeDriveLetter = (string: string) => {
  if (string.match(/^[a-zA-Z]:/))
    return string.slice(2)

  return string
}
const replaceDoubleSlashes = (string: string) => string.replace(/\\/g, '/')

export function sanitizeFilePath(path: string, isTestPattern: boolean) {
  if (isWindows) {
    if (isTestPattern)
      return replaceDoubleSlashes(removeDriveLetter(path))
    else
      return replaceDoubleSlashes(path)
  }

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
