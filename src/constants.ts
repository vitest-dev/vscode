import { resolve } from 'pathe'

export const distDir = resolve(__filename)
export const workerPath = resolve(__dirname, 'worker.mjs')
export const debugPath = resolve(__dirname, 'debug.mjs')
