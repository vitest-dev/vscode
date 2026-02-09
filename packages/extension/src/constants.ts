import { resolve } from 'pathe'

export const minimumVersion = '1.4.0'
// follows minimum Vitest
export const minimumNodeVersion = '18.0.0'

export const distDir = __dirname
export const workerPath = resolve(__dirname, 'worker.js')
export const browserSetupFilePath = resolve(__dirname, 'browserSetupFile.mjs')

export const configGlob = '**/*{vite,vitest}*.config*.{ts,js,mjs,cjs,cts,mts}'
export const workspaceGlob = '**/*vitest.{workspace,projects}*.{ts,js,mjs,cjs,cts,mts,json}'

export const finalCoverageFileName = 'coverage-final.json'
