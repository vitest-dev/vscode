import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Server } from 'node:http'
import type WebSocket from 'ws'
import type { ResolvedMeta } from '../api'
import type { VitestPackage } from './pkg'
import type { ExtensionWorkerProcess } from './types'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import getPort from 'get-port'
import { WebSocketServer } from 'ws'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import { createErrorLogger, log } from '../log'
import { findNode, formatPkg, showVitestError } from '../utils'
import { waitForWsConnection } from './ws'

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
  const executable = await findNode(pkg.cwd)
  const script = `${executable} ${arvString ? `${arvString} ` : ''}${workerPath}`.trim()
  log.info('[API]', `Running ${formatPkg(pkg)} with "${script}"`)
  const logLevel = getConfig(pkg.folder).logLevel
  const port = await getPort()
  const server = createServer().listen(port).unref()
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`
  const vitest = spawn(executable, [...execArgv, workerPath], {
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

    function onError(error: Error) {
      reject(error)
      log.error('Current PATH:', process.env.PATH)
    }

    vitest.on('exit', onExit)
    vitest.on('error', onError)

    waitForWsConnection(wss, pkg, false, 'child_process', false)
      .then((resolved) => {
        resolved.handlers.onStdout = (callback: (data: string) => void) => {
          stdoutCallbacks.add(callback)
        }
        const clearListeners = resolved.handlers.clearListeners
        resolved.handlers.clearListeners = () => {
          clearListeners()
          stdoutCallbacks.clear()
        }
        resolve({
          ...resolved,
          process: new ExtensionChildProcess(vitest, server, resolved.ws),
        })
      }, reject)
      .finally(() => {
        vitest.off('exit', onExit)
        vitest.off('exit', onError)
      })
  })
}

class ExtensionChildProcess implements ExtensionWorkerProcess {
  public id: number
  private stopped: Promise<void>

  constructor(
    private child: ChildProcessWithoutNullStreams,
    server: Server,
    ws: WebSocket,
  ) {
    // the execution process cannot be created without a pid
    this.id = child.pid!
    this.stopped = new Promise<void>((resolve, reject) => {
      child.on('exit', () => {
        server.close(createErrorLogger('Failed to close server'))
        resolve()
      })
      child.on('error', reject)
    })
    // stop the process if websocket connection was somehow closed
    ws.on('close', () => {
      if (!child.killed) {
        child.kill()
      }
    })
  }

  get closed(): boolean {
    return this.child.killed
  }

  close() {
    this.child.kill()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('The extension child process did not exit in time.'))
      }, 5_000)
      this.stopped
        .finally(() => clearTimeout(timer))
        .then(resolve, reject)
    })
  }

  onError(listener: (error: Error) => void, options?: { once?: boolean }) {
    const method = options?.once ? 'once' : 'on'
    this.child[method]('error', listener)
    return () => {
      this.child.off('error', listener)
    }
  }

  onExit(listener: (code: number | null) => void, options?: { once?: boolean }) {
    const method = options?.once ? 'once' : 'on'
    this.child[method]('exit', listener)
    return () => {
      this.child.off('exit', listener)
    }
  }
}
