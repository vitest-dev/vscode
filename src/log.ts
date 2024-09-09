/* eslint-disable no-console */

import { window } from 'vscode'
import { getConfig } from './config'

const _log = window.createOutputChannel('Vitest')
export const log = {
  worker: (type: 'info' | 'error', ...args: any[]) => {
    if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('\n'))
      args[args.length - 1] = args.at(-1).slice(0, process.platform === 'win32' ? -2 : -1)

    const time = new Date().toLocaleTimeString()
    if (process.env.EXTENSION_NODE_ENV === 'dev') {
      console[type](`[INFO ${time}]`, '[Worker]', ...args)
    }
    _log.appendLine(`[INFO ${time}] [Worker] ${args.join(' ')}`)
  },
  info: (...args: any[]) => {
    if (process.env.EXTENSION_NODE_ENV === 'dev') {
      console.log(...args)
    }
    const time = new Date().toLocaleTimeString()
    _log.appendLine(`[INFO ${time}] ${args.join(' ')}`)
  },
  error: (...args: any[]) => {
    if (process.env.EXTENSION_NODE_ENV === 'dev') {
      console.error(...args)
    }
    const time = new Date().toLocaleTimeString()
    for (let i = 0; i < args.length; i++) {
      if (args[i] instanceof Error) {
        const err = args[i] as Error
        args[i] = `[Error ${err.name}] ${err.message}\n${err.stack}`
      }
    }
    _log.appendLine(`[Error ${time}] ${args.join(' ')}`)
  },
  verbose: getConfig().logLevel === 'verbose' || process.env.VITEST_VSCODE_LOG === 'verbose'
    ? undefined
    : (...args: string[]) => {
        const time = new Date().toLocaleTimeString()
        if (process.env.EXTENSION_NODE_ENV === 'dev') {
          console.log(`[${time}]`, ...args)
        }
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
