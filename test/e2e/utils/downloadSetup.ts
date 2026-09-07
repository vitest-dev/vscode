import { download } from '@vscode/test-electron'
import type { TestProject } from 'vitest/node'

export default async function downloadVscode({ provide }: TestProject) {
  if (process.env.VSCODE_E2E_DOWNLOAD_PATH)
    provide('executablePath', process.env.VSCODE_E2E_DOWNLOAD_PATH)
  else provide('executablePath', await download())
}

declare module 'vitest' {
  export interface ProvidedContext {
    executablePath: string
  }
}
