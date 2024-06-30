/* eslint-disable no-console */

import { window } from 'vscode'

const _log = window.createOutputChannel('Vitest')
export const log = {
  worker: (type: 'info' | 'error', ...args: any[]) => {
    if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('\n'))
      args[args.length - 1] = args.at(-1).slice(0, process.platform === 'win32' ? -2 : -1)

    console[type]('[Worker]', ...args)
    _log.appendLine(`[Worker] ${args.join(' ')}`)
  },
  info: (...args: any[]) => {
    console.log(...args)
    const time = new Date().toLocaleTimeString()
    _log.appendLine(`[INFO ${time}] ${args.join(' ')}`)
  },
  error: (...args: any[]) => {
    console.error(...args)
    const time = new Date().toLocaleTimeString()
    for (let i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) {
        const err = args[i] as Error
        args[i] = `[Error ${err.name}] ${err.message}\n${err.stack}`
      }
    }
    _log.appendLine(`[Error ${time}] ${args.join(' ')}`)
  },
  verbose: process.env.VITEST_VSCODE_DEBUG !== 'true'
    ? undefined
    : (...args: string[]) => {
        const time = new Date().toLocaleTimeString()
        console.log(`[${time}]`, ...args)
        _log.appendLine(`[${time}] ${args.join(' ')}`)
      },
  workspaceInfo: (folder: string, ...args: any[]) => {
    log.info(`[Workspace ${folder}]`, ...args)
  },
  workspaceError: (folder: string, ...args: any[]) => {
    log.error(`[Workspace ${folder}]`, ...args)
  },
  openOuput() {
    _log.show()
  },
} as const
