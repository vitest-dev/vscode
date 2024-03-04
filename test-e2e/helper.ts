import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { download } from '@vscode/test-electron'
import { _electron } from 'playwright'
import type { Page } from 'playwright'
import { test } from 'vitest'

// based on
// https://github.com/microsoft/playwright-vscode/blob/1c2f766a3ef4b7633fb19103a3d930ebe385250e/tests-integration/tests/baseTest.ts#L41
// https://github.com/hi-ogawa/vscode-extension-shell-shortcut/tree/df7ee738f60d76bdf30baf852a4bb5abffd16e13/packages/e2e

export function createVscodeTest({
  extensionPath,
  workspacePath,
  trace,
}: {
  extensionPath: string
  workspacePath: string
  trace?: boolean
}) {
  return test.extend<{ page: Page }>({
    page: async ({ task }, use) => {
      const executablePath = await download()
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-e2e-'))
      const app = await _electron.launch({
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-gpu-sandbox',
          '--disable-updates',
          '--skip-welcome',
          '--skip-release-notes',
          '--disable-workspace-trust',
          `--extensions-dir=${path.join(tempDir, 'extensions')}`,
          `--user-data-dir=${path.join(tempDir, 'user-data')}`,
          `--extensionDevelopmentPath=${path.resolve(extensionPath)}`,
          `--folder-uri=file:${path.resolve(workspacePath)}`,
        ],
      })
      const page = await app.firstWindow()
      if (trace)
        await page.context().tracing.start({ screenshots: true, snapshots: true })

      await use(page)
      if (trace) {
        const name = `${task.name.replace(/\W/g, '-')}-${task.id}`
        await page.context().tracing.stop({ path: `test-results/${name}/basic.zip` })
      }
      await app.close()
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    },
  })
}
