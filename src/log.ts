/* eslint-disable no-console */

import { appendFileSync, writeFileSync } from 'node:fs'
import { window } from 'vscode'
import { getConfig } from './config'

const logFile = process.env.VITEST_VSCODE_E2E_LOG_FILE!
const channel = window.createOutputChannel('Vitest')
export const log = {
  worker: (type: 'info' | 'error', ...args: any[]) => {
    if (typeof args.at(-1) === 'string' && args.at(-1).endsWith('\n'))
      args[args.length - 1] = args.at(-1).slice(0, process.platform === 'win32' ? -2 : -1)

    const time = new Date().toLocaleTimeString()
    if (process.env.EXTENSION_NODE_ENV === 'dev') {
      console[type](`[INFO ${time}]`, '[Worker]', ...args)
    }
    const message = `[INFO ${time}] [Worker] ${args.join(' ')}`
    if (logFile) {
      appendFile(message)
    }
    channel.appendLine(message)
  },
  info: (...args: any[]) => {
    if (process.env.EXTENSION_NODE_ENV === 'dev') {
      console.log(...args)
    }
    const time = new Date().toLocaleTimeString()
    const message = `[INFO ${time}] ${args.join(' ')}`
    if (logFile) {
      appendFile(message)
    }
    channel.appendLine(message)
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
    const message = `[Error ${time}] ${args.join(' ')}`
    if (logFile) {
      appendFile(message)
    }
    channel.appendLine(message)
  },
  verbose: getConfig().logLevel === 'verbose' || process.env.VITEST_VSCODE_LOG === 'verbose'
    ? (...args: string[]) => {
        const time = new Date().toLocaleTimeString()
        if (process.env.EXTENSION_NODE_ENV === 'dev') {
          console.log(`[${time}]`, ...args)
        }
        const message = `[${time}] ${args.join(' ')}`
        if (logFile) {
          appendFile(message)
        }
        channel.appendLine(message)
      }
    : undefined,
  workspaceInfo: (folder: string, ...args: any[]) => {
    log.info(`[Workspace ${folder}]`, ...args)
  },
  workspaceError: (folder: string, ...args: any[]) => {
    log.error(`[Workspace ${folder}]`, ...args)
  },
  openOuput() {
    channel.show()
  },
} as const

let exitsts = false
function appendFile(log: string) {
  if (!exitsts) {
    writeFileSync(logFile, '')
    exitsts = true
  }
  appendFileSync(logFile, `${log}\n`)
}
