import { resolve } from 'pathe'

export const minimumVersion = '1.4.0'

export const distDir = resolve(__filename)
export const workerPath = resolve(__dirname, 'worker.js')
export const setupFilePath = resolve(__dirname, 'setupFile.mjs')

export const configGlob = '**/*{vite,vitest}*.config*.{ts,js,mjs,cjs,cts,mts}'
export const workspaceGlob = '**/*vitest.{workspace,projects}*.{ts,js,mjs,cjs,cts,mts,json}'
