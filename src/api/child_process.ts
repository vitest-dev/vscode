import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import getPort from 'get-port'
import { WebSocketServer } from 'ws'
import { formatPkg, showVitestError } from '../utils'
import { log } from '../log'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import type { ResolvedMeta } from '../api'
import type { VitestPackage } from './pkg'
import { waitForWsResolvedMeta } from './ws'

export async function createVitestProcess(pkg: VitestPackage) {
  const pnpLoader = pkg.loader
  const pnp = pkg.pnp
  if (pnpLoader && !pnp)
    throw new Error('pnp file is required if loader option is used')
  const env = getConfig().env || {}
  const runtimeArgs = getConfig(pkg.folder).nodeExecArgs || []
  const execArgv = pnpLoader && pnp
    ? [
        '--require',
        pnp,
        '--experimental-loader',
        pathToFileURL(pnpLoader).toString(),
        ...runtimeArgs,
      ]
    : runtimeArgs
  const arvString = execArgv.join(' ')
  const script = `node ${arvString ? `${arvString} ` : ''}${workerPath}`.trim()
  log.info('[API]', `Running ${formatPkg(pkg)} with "${script}"`)
  const logLevel = getConfig(pkg.folder).logLevel
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`
  const vitest = spawn(getConfig(pkg.folder).nodeExecutable || 'node', [...execArgv, workerPath], {
    env: {
      ...process.env,
      ...env,
      VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? logLevel,
      VITEST_VSCODE: 'true',
      // same env var as `startVitest`
      // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
      TEST: 'true',
      VITEST_WS_ADDRESS: wsAddress,
      VITEST: 'true',
      NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
    },
    cwd: pkg.cwd,
  })

  const stdoutCallbacks = new Set<(data: string) => void>()

  vitest.stdout?.on('data', (d) => {
    const content = d.toString()
    stdoutCallbacks.forEach(cb => cb(content))
    log.worker('info', content)
  })
  vitest.stderr?.on('data', (chunk) => {
    const string = chunk.toString()
    log.worker('error', string)
    stdoutCallbacks.forEach(cb => cb(string))
    if (string.startsWith(' MISSING DEPENDENCY')) {
      const error = string.split(/\r?\n/, 1)[0].slice(' MISSING DEPENDENCY'.length)
      showVitestError(error)
    }
  })

  vitest.on('exit', () => {
    stdoutCallbacks.clear()
  })

  return new Promise<ResolvedMeta>((resolve, reject) => {
    function onExit(code: number | null) {
      reject(new Error(`Vitest process exited with code ${code}`))
    }

    vitest.on('exit', onExit)

    waitForWsResolvedMeta(wss, pkg, false, 'child_process', vitest)
      .then((resolved) => {
        resolved.handlers.onStdout = (callback: (data: string) => void) => {
          stdoutCallbacks.add(callback)
        }
        const clearListeners = resolved.handlers.clearListeners
        resolved.handlers.clearListeners = () => {
          clearListeners()
          stdoutCallbacks.clear()
        }
        resolve(resolved)
      }, reject)
      .finally(() => {
        vitest.off('exit', onExit)
      })
  })
}
