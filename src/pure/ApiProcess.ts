import type { ChildProcess, SpawnOptionsWithStdioTuple, StdioNull, StdioPipe } from 'child_process'
import getPort from 'get-port'
import type { File, WebSocketEvents } from 'vitest'
import type { CancellationToken } from 'vscode'
import kill from 'tree-kill'
import { getConfig } from '../config'
import { log } from '../log'
import { execWithLog, filterColorFormatOutput, sanitizeFilePath } from './utils'
import { buildWatchClient } from './watch/client'

type Handlers = Partial<WebSocketEvents> & { log?: (msg: string) => void; onUpdate?: (files: File[]) => void }
export interface StartConfig {
  cmd: string
  args: string[]
  cfg: Partial<SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>>
  log: (line: string) => void
  onProcessEnd: () => void
  registerOnTestFinished: (onTestFinished: () => void) => void
}

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
    private customStartProcess?: (config: StartConfig) => void,
  ) {
    if (this.handlers.log && !this.handlers.onUserConsoleLog) {
      this.handlers.onUserConsoleLog = ({ content }) => {
        this.handlers.log?.(content)
      }
    }
    if (this.handlers.onUpdate) {
      const taskUpdateHandler = this.handlers.onTaskUpdate
      this.handlers.onTaskUpdate = (packs) => {
        taskUpdateHandler && taskUpdateHandler(packs)
        if (!this.vitestState)
          return

        const idMap = this.vitestState.client.state.idMap
        const fileSet = new Set<File>()
        for (const [id] of packs) {
          const task = idMap.get(id)
          if (!task)
            continue

          task.file && fileSet.add(task.file)
        }

        this.handlers.onUpdate && this.handlers.onUpdate(Array.from(fileSet))
      }
    }
  }

  async start() {
    if (this.started || this.disposed)
      return

    this.started = true
    const port = await getPort()

    const _log = (line: string) => {
      line = filterColorFormatOutput(line)
      log.info(line)
      this.handlers.log && this.handlers.log(line)
    }

    log.info('Start api process at port', port)
    log.info('[RUN]', `${this.vitest.cmd} ${this.vitest.args.join(' ')}`)
    const cwd = sanitizeFilePath(this.workspace)
    log.info('[RUN.cwd]', cwd)

    const logs = [] as string[]
    let timer: any
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
    if (!this.customStartProcess) {
      this._start(debouncedLog, port, cwd)
    }
    else {
      this.customStartProcess({
        cmd: this.vitest.cmd,
        args: [...this.vitest.args, '--api.port', port.toString(), '--api.host', '127.0.0.1'],
        cfg: {
          cwd,
          env: { ...process.env, ...getConfig(this.workspace).env },
        },
        log: debouncedLog,
        onProcessEnd: () => {
          log.info('API PROCESS EXIT')
          this.handlers.onFinished?.()
          this.dispose()
        },
        registerOnTestFinished: (onTestFinished: () => void) => {
          const onFinished = this.handlers.onFinished
          this.handlers.onFinished = (...args) => {
            onFinished?.(...args)
            onTestFinished()
          }
        },
      })
    }

    setTimeout(() => {
      this.vitestState = buildWatchClient({
        port,
        handlers: this.handlers,
        // vitest could take up to 10 seconds to start up on some computers, so reconnects need to be long enough to handle that
        reconnectInterval: 500,
        reconnectTries: 20,
      })

      this.vitestState.loadingPromise.then((isRunning) => {
        if (!isRunning) {
          const files = this.vitestState!.files.value
          files && this.handlers?.onFinished?.(files)
        }
      })
    }, 50)
  }

  kill() {
    // Kill using tree-kill to ensure all child processes are killed.
    // Especially necessary on Windows, due to shell: true being passed to spawn.
    if (this.process && this.process.pid)
      kill(this.process.pid)
    this.handlers.onFinished?.()
  }

  private _start(debouncedLog: (line: string) => void, port: number, cwd: string) {
    this.process = execWithLog(
      this.vitest.cmd,
      [...this.vitest.args, '--api.port', port.toString(), '--api.host', '127.0.0.1'],
      {
        cwd,
        env: { ...process.env, ...getConfig(this.workspace).env },
      },
      debouncedLog,
      debouncedLog,
    ).child

    this.process.on('error', (err) => {
      log.error(`Process Error: ${err}`)
    })

    this.process.on('exit', (code) => {
      if (this.disposed)
        return

      if (code !== 0) {
        this.dispose()
        log.error(`Process exited with code ${code}`)
        return
      }

      log.info('API PROCESS EXIT')
      this.handlers.onFinished?.()
      this.dispose()
    })
  }

  get client() {
    return this.vitestState?.client
  }

  dispose() {
    this.disposed = true
    this.vitestState?.client.dispose()
    if (this.process && this.process.pid)
      kill(this.process.pid)
    this.vitestState = undefined
    this.process = undefined
  }
}

export function runVitestWithApi(
  vitest: { cmd: string; args: string[] },
  workspace: string,
  handlers: Handlers,
  customStartProcess?: (config: StartConfig) => void,
  cancellationToken?: CancellationToken,
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
    }, true, customStartProcess)
    process.start()

    cancellationToken?.onCancellationRequested(() => {
      process.kill()
    })
  })
}
