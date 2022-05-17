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

export function getVitestCommand(
  projectRoot: string,
): { cmd: string; args: string[] } | undefined {
  const node_modules = path.resolve(projectRoot, 'node_modules')
  if (!existsSync(node_modules))
    return

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
}

export async function getVitestVersion(
  vitestCommand?: { cmd: string; args: string[] },
): Promise<string> {
  let process
  if (vitestCommand == null) {
    process = spawn('npx', ['vitest', '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  else {
    process = spawn(vitestCommand.cmd, [...vitestCommand.args, '-v'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  // eslint-disable-next-line no-unreachable-loop
  for await (const line of chunksToLinesAsync(process.stdout)) {
    process.kill()
    return line.match(/vitest\/(\d+.\d+.\d+)/)![1]
  }

  throw new Error(`Cannot get vitest version from "${JSON.stringify(vitestCommand)}"`)
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
