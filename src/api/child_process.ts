import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import getPort from 'get-port'
import { WebSocketServer } from 'ws'
import { formatPkg } from '../utils'
import { log } from '../log'
import type { ResolvedMeta } from '../api'
import { getConfig } from '../config'
import { workerPath } from '../constants'
import type { VitestPackage } from './pkg'
import { waitForWsResolvedMeta } from './ws'

async function createChildVitestProcess(pkg: VitestPackage) {
  const pnpLoader = pkg.loader
  const pnp = pkg.pnp
  if (pnpLoader && !pnp)
    throw new Error('pnp file is required if loader option is used')
  const env = getConfig().env || {}
  // const execPath = await findNode(vscode.workspace.workspaceFile?.fsPath || pkg.cwd)
  // const execVersion = await getNodeJsVersion(execPath)
  // if (execVersion && !gte(execVersion, minimumNodeVersion)) {
  //   const errorMsg = `Node.js version ${execVersion} is not supported. Minimum required version is ${minimumNodeVersion}`
  //   log.error('[API]', errorMsg)
  //   throw new Error(errorMsg)
  // }
  const runtimeArgs = getConfig(pkg.folder).nodeExecArgs || []
  const execArgv = pnpLoader && pnp // && !gte(execVersion, '18.19.0')
    ? [
        '--require',
        pnp,
        '--experimental-loader',
        pathToFileURL(pnpLoader).toString(),
        ...runtimeArgs,
      ]
    : runtimeArgs
  const script = `node ${workerPath} ${execArgv.join(' ')}`.trim()
  log.info('[API]', `Running ${formatPkg(pkg)} with "${script}"`)
  const logLevel = getConfig(pkg.folder).logLevel
  const port = await getPort()
  const server = createServer().listen(port)
  const wss = new WebSocketServer({ server })
  const wsAddress = `ws://localhost:${port}`
  spawn('node', [workerPath, ...execArgv], {
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
    // stdio: 'overlapped',
    cwd: pkg.cwd,
  })

  return await waitForWsResolvedMeta(wss, pkg, true, 'child_process')
  // const vitest = fork(
  //   workerPath,
  //   {
  //     execPath,
  //     execArgv,
  //     env: {
  //       ...process.env,
  //       ...env,
  //       VITEST_VSCODE_LOG: env.VITEST_VSCODE_LOG ?? process.env.VITEST_VSCODE_LOG ?? logLevel,
  //       VITEST_VSCODE: 'true',
  //       // same env var as `startVitest`
  //       // https://github.com/vitest-dev/vitest/blob/5c7e9ca05491aeda225ce4616f06eefcd068c0b4/packages/vitest/src/node/cli/cli-api.ts
  //       TEST: 'true',
  //       VITEST: 'true',
  //       NODE_ENV: env.NODE_ENV ?? process.env.NODE_ENV ?? 'test',
  //     },
  //     stdio: 'overlapped',
  //     cwd: pkg.cwd,
  //   },
  // )

  // vitest.stdout?.on('data', d => log.worker('info', d.toString()))
  // vitest.stderr?.on('data', (chunk) => {
  //   const string = chunk.toString()
  //   log.worker('error', string)
  //   if (string.startsWith(' MISSING DEPENDENCY')) {
  //     const error = string.split(/\r?\n/, 1)[0].slice(' MISSING DEPENDENCY'.length)
  //     showVitestError(error)
  //   }
  // })

  // return new Promise<{ process: ChildProcess; configs: string[] }>((resolve, reject) => {
  //   function onMessage(message: WorkerEvent) {
  //     if (message.type === 'debug')
  //       log.worker('info', ...message.args)

  //     if (message.type === 'ready') {
  //       resolve({ process: vitest, configs: message.configs })
  //     }
  //     if (message.type === 'error') {
  //       const error = new Error(`Vitest failed to start: \n${message.error}`)
  //       reject(error)
  //     }
  //     vitest.off('error', onError)
  //     vitest.off('message', onMessage)
  //     vitest.off('exit', onExit)
  //   }

  //   function onError(err: Error) {
  //     log.error('[API]', err)
  //     reject(err)
  //     vitest.off('error', onError)
  //     vitest.off('message', onMessage)
  //     vitest.off('exit', onExit)
  //   }

  //   function onExit(code: number) {
  //     reject(new Error(`Vitest process exited with code ${code}`))
  //   }

  //   vitest.on('error', onError)
  //   vitest.on('message', onMessage)
  //   vitest.on('exit', onExit)
  //   vitest.once('spawn', () => {
  //     const runnerOptions: WorkerRunnerOptions = {
  //       type: 'init',
  //       meta: {
  //         shellType: 'child_process',
  //         vitestNodePath: pkg.vitestNodePath,
  //         env: getConfig(pkg.folder).env || undefined,
  //         configFile: pkg.configFile,
  //         cwd: pkg.cwd,
  //         arguments: pkg.arguments,
  //         workspaceFile: pkg.workspaceFile,
  //         id: pkg.id,
  //         pnpApi: pnp,
  //         pnpLoader: pnpLoader // && gte(execVersion, '18.19.0')
  //           ? pathToFileURL(pnpLoader).toString()
  //           : undefined,
  //       },
  //       debug: false,
  //       astCollect: getConfig(pkg.folder).experimentalStaticAstCollect,
  //     }

  //     vitest.send(runnerOptions)
  //   })
  // })
}

export async function createVitestProcess(pkg: VitestPackage): Promise<ResolvedMeta> {
  return await createChildVitestProcess(pkg)

  // log.info('[API]', `${formatPkg(pkg)} child process ${vitest.pid} created`)

  // const { handlers, api } = createVitestRpc({
  //   on: listener => vitest.on('message', listener),
  //   send: message => vitest.send(message),
  // })

  // vitest.once('exit', () => {
  //   log.verbose?.('[API]', 'Vitest child_process connection closed, cannot call RPC anymore.')
  //   api.$close()
  // })

  // return {
  //   rpc: api,
  //   configs,
  //   process: new VitestChildProcess(vitest),
  //   handlers,
  //   pkg,
  // }
}

// class VitestChildProcess implements VitestProcess {
//   constructor(private child: ChildProcess) {}

//   get id() {
//     return this.child.pid ?? 0
//   }

//   get closed() {
//     return this.child.killed
//   }

//   on(event: string, listener: (...args: any[]) => void) {
//     this.child.on(event, listener)
//   }

//   once(event: string, listener: (...args: any[]) => void) {
//     this.child.once(event, listener)
//   }

//   off(event: string, listener: (...args: any[]) => void) {
//     this.child.off(event, listener)
//   }

//   close() {
//     this.child.kill()
//   }
// }
