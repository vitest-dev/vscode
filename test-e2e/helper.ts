import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { download } from '@vscode/test-electron'
import { _electron } from 'playwright'
import type { Page } from 'playwright'
import { test as baseTest } from 'vitest'

// based on
// https://github.com/microsoft/playwright-vscode/blob/1c2f766a3ef4b7633fb19103a3d930ebe385250e/tests-integration/tests/baseTest.ts#L41

type LaunchFixture = (options: {
  extensionPath?: string
  workspacePath?: string
  trace?: 'on' | 'off'
}) => Promise<{ page: Page }>

const defaultConfig = process.env as {
  VSCODE_E2E_DOWNLOAD_PATH?: string
  VSCODE_E2E_EXTENSION_PATH?: string
  VSCODE_E2E_WORKSPACE_PATH?: string
  VSCODE_E2E_TRACE?: 'on' | 'off'
}

export const test = baseTest.extend<{ launch: LaunchFixture }>({
  launch: async ({ task }, use) => {
    const teardowns: (() => Promise<void>)[] = []

    await use(async (options) => {
      const executablePath = defaultConfig.VSCODE_E2E_DOWNLOAD_PATH ?? await download()
      const extensionPath = options.extensionPath ?? defaultConfig.VSCODE_E2E_EXTENSION_PATH
      const workspacePath = options.workspacePath ?? defaultConfig.VSCODE_E2E_WORKSPACE_PATH
      const trace = (options.trace ?? defaultConfig.VSCODE_E2E_TRACE) === 'on'

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
          extensionPath && `--extensionDevelopmentPath=${path.resolve(extensionPath)}`,
          workspacePath && `--folder-uri=file:${path.resolve(workspacePath)}`,
        ].filter((v): v is string => !!v),
      })
      const page = await app.firstWindow()

      if (trace)
        await page.context().tracing.start({ screenshots: true, snapshots: true })

      const teardown = async () => {
        if (trace) {
          const name = `${task.name.replace(/\W/g, '-')}-${task.id}`
          await page.context().tracing.stop({ path: `test-results/${name}/basic.zip` })
        }
        await app.close()
        await fs.promises.rm(tempDir, { recursive: true, force: true })
      }
      teardowns.push(teardown)

      return { page }
    })

    for (const teardown of teardowns)
      await teardown()
  },
})
