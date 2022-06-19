import type { ChildProcess } from 'child_process'
import getPort from 'get-port'
import type { WebSocketEvents } from 'vitest'
import { getConfig } from '../config'
import { log } from '../log'
import { execWithLog, filterColorFormatOutput, sanitizeFilePath } from './utils'
import { buildWatchClient } from './watch/client'

type Handlers = Partial<WebSocketEvents> & { log?: (msg: string) => void }

export class ApiProcess {
  private process?: ChildProcess
  private vitestState?: ReturnType<typeof buildWatchClient>
  private started = false
  private disposed = false
  output: string[] = []

  constructor(
    private vitest: { cmd: string; args: string[] },
    private workspace: string,
    private handlers: Handlers = {},
    private recordOutput = false,
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
      line = filterColorFormatOutput(line)
      log.info(line)
      this.handlers.log && this.handlers.log(line)
    }

    log.info('Start api process at port', port)
    log.info('[RUN]', `${this.vitest.cmd} ${this.vitest.args.join(' ')}`)
    const cwd = sanitizeFilePath(this.workspace)
    log.info('[RUN.cwd]', cwd)
    const debouncedLog = (line: string) => {
      logs.push(line)
      if (this.recordOutput)
        this.output.push(line)

      clearTimeout(timer)
      timer = setTimeout(() => {
        _log(logs.join('\r\n'))
        logs.length = 0
      }, 200)
    }
    this.process = execWithLog(
      this.vitest.cmd,
      [...this.vitest.args, '--api', port.toString()],
      {
        cwd,
        env: { ...process.env, ...getConfig(this.workspace).env },
      },
      debouncedLog,
      debouncedLog,
    ).child

    this.process.on('exit', () => {
      log.info('API PROCESS EXIT')
      this.handlers.onFinished?.()
      this.dispose()
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
): Promise<string> {
  log.info('[Execute Vitest]', vitest.cmd, vitest.args.join(' '))
  return new Promise<string>((resolve) => {
    const process = new ApiProcess(vitest, workspace, {
      ...handlers,
      onFinished: (files) => {
        log.info('Vitest api process finished')
        try {
          handlers.onFinished && handlers.onFinished(files)
        }
        finally {
          process.dispose()
          resolve(process.output.join(''))
        }
      },
    }, true)
    process.start()
  })
}
