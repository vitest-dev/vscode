import type { Socket } from 'node:net'
import { connect } from 'node:net'
import cac from 'cac'
import { parse, stringify } from 'flatted'
import type { BirpcReturn } from 'birpc'
import { parseErrorStacktrace } from '@vitest/utils/source-map'
import { createWorkerRPC } from '../rpc'
import type { BirpcEvents, BirpcMethods } from '../api'

// TODO: support CLI arguments via "parseCLI" from "vitest/node" on 1.3.1+
const cli = cac('vitest')

cli.command('<test-files...>', 'Run tests', {
  allowUnknownOptions: true,
})

// TODO: for now only supports "--config" option
async function runVitest(argv: string[]) {
  const { options } = cli.parse(argv, {
    run: false,
  })

  const socket = connect(options.socket)

  const vitestMode = await import(options.vitestPath) as typeof import('vitest/node')

  let rpc: BirpcReturn<BirpcEvents, BirpcMethods>
  const ctx = await vitestMode.createVitest('test', {
    config: options.config,
    watch: true,
    root: options.root,
    reporters: [
      {
        onUserConsoleLog(log) {
          rpc.onConsoleLog(log)
        },
        onTaskUpdate(packs) {
          packs.forEach(([taskId, result]) => {
            const project = ctx.getProjectByTaskId(taskId)

            result?.errors?.forEach((error) => {
              if (typeof error === 'object' && error) {
                error.stacks = parseErrorStacktrace(error, {
                  getSourceMap: file => project.getBrowserSourceMapModuleById(file),
                })
              }
            })
          })

          rpc.onTaskUpdate(packs)
        },
        onFinished(files, errors) {
          rpc.onFinished(files, errors)
        },
        onCollected(files) {
          rpc.onCollected(files)
        },
        onWatcherStart(files, errors) {
          rpc.onWatcherStart(files, errors)
        },
        onWatcherRerun(files, trigger) {
          rpc.onWatcherRerun(files, trigger)
        },
      },
    ],
  })

  rpc = createWorkerRPC(ctx, {
    on(listener) {
      socket.on('data', (data) => {
        data.toString('utf-8').split('$~0~$').forEach((message) => {
          if (message)
            listener(message)
        })
      })
    },
    post(message) {
      // We add "$~0~$" to the end of the message to split it on the other side
      // Because socket can send multiple messages at once
      socket.write(`${message}$~0~$`)
    },
    serialize(data: unknown): string {
      return stringify(data)
    },
    deserialize(data: string): unknown {
      return parse(data)
    },
  })

  if (socket.readyState !== 'open')
    socket.on('connect', () => ready(socket, options.root))
  else
    ready(socket, options.root)
}

function ready(socket: Socket, root: string) {
  socket.write(JSON.stringify({ type: 'ready', root }))
}

runVitest(process.argv)
