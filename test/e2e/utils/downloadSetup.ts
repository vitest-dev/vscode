import { download } from '@vscode/test-electron'
import type { Vitest } from 'vitest/node'

export default async function downloadVscode(vitest: Vitest) {
  if (process.env.VSCODE_E2E_DOWNLOAD_PATH)
    vitest.provide('executablePath', process.env.VSCODE_E2E_DOWNLOAD_PATH)
  else
    vitest.provide('executablePath', await download())
}

declare module 'vitest' {
  export interface ProvidedContext {
    executablePath: string
  }
}
