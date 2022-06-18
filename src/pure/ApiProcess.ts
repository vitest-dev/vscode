import type { ChildProcess } from 'child_process'
import getPort from 'get-port'
import type { WebSocketEvents } from 'vitest'
import { getConfig } from '../config'
import { log } from '../log'
import { execWithLog } from './utils'
import { buildWatchClient } from './watch/client'

type Handlers = Partial<WebSocketEvents> & { log?: (msg: string) => void }

export class ApiProcess {
  private process?: ChildProcess
  private vitestState?: ReturnType<typeof buildWatchClient>
  private started = false
  private disposed = false

  constructor(
    private vitest: { cmd: string; args: string[] },
    private workspace: string,
    private handlers: Handlers = {},
  ) {
    if (this.handlers.log && !this.handlers.onUserConsoleLog) {
      this.handlers.onUserConsoleLog = ({ content }) => {
        this.handlers.log?.(content)
      }
    }
  }

  async start() {
    if (this.started || this.disposed)
      return

    this.started = true
    const port = await getPort()

    const logs = [] as string[]
    let timer: any
    const _log = (line: string) => {
      log.info(line)
      this.handlers.log && this.handlers.log(line)
    }

    log.info('Start api process at port', port)
    this.process = execWithLog(
      this.vitest.cmd,
      [...this.vitest.args, '--api', port.toString()],
      {
        cwd: this.workspace,
        env: { ...process.env, ...getConfig(this.workspace).env },
      },
      (line) => {
        logs.push(line)
        clearTimeout(timer)
        timer = setTimeout(() => {
          _log(logs.join('\r\n'))
          logs.length = 0
        }, 200)
      },
      (line) => {
        logs.push(line)
        clearTimeout(timer)
        timer = setTimeout(() => {
          _log(logs.join('\r\n'))
          logs.length = 0
        }, 200)
      },
    ).child

    this.process.on('exit', () => {
      log.info('API PROCESS EXIT')
    })

    this.vitestState = buildWatchClient({
      port,
      handlers: this.handlers,
    })

    this.vitestState.loadingPromise.then((isRunning) => {
      if (!isRunning) {
        const files = this.vitestState!.files.value
        files && this.handlers?.onFinished?.(files)
      }
    })
  }

  get client() {
    return this.vitestState?.client
  }

  dispose() {
    this.disposed = true
    this.vitestState?.client.dispose()
    this.process?.kill()
    this.vitestState = undefined
    this.process = undefined
  }
}

export function runVitestWithApi(
  vitest: { cmd: string; args: string[] },
  workspace: string,
  handlers: Handlers,
) {
  return new Promise<void>((resolve) => {
    const process = new ApiProcess(vitest, workspace, {
      ...handlers,
      onFinished: (files) => {
        log.info('Vitest api process finished')
        handlers.onFinished && handlers.onFinished(files)
        process.dispose()
        resolve()
      },
    })
    process.start()
  })
}
