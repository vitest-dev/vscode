import { resolve } from 'pathe'

export const minimumVersion = '1.4.0'
export const minimumDebugVersion = '1.5.0'

export const distDir = __dirname
export const workerPath = resolve(__dirname, 'worker.js')
export const debuggerPath = resolve(__dirname, 'debug.js')
export const setupFilePath = resolve(__dirname, 'setupFile.mjs')

export const configGlob = '**/*{vite,vitest}*.config*.{ts,js,mjs,cjs,cts,mts}'
export const workspaceGlob = '**/*vitest.{workspace,projects}*.{ts,js,mjs,cjs,cts,mts,json}'
