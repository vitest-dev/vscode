import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Awaitable } from 'vitest'
import { test as baseTest, inject } from 'vitest'
import { VSCodeTester } from './tester'

// based on
// https://github.com/microsoft/playwright-vscode/blob/1c2f766a3ef4b7633fb19103a3d930ebe385250e/tests-integration/tests/baseTest.ts#L41

interface Context {
  page: Page
  tester: VSCodeTester

}

type LaunchFixture = (options: {
  extensionPath?: string
  workspacePath?: string
  trace?: 'on' | 'off'
}) => Promise<Context & {
  step: (name: string, fn: (context: Context) => Awaitable<void>) => Promise<void>
}>

const defaultConfig = process.env as {
  VSCODE_E2E_EXTENSION_PATH?: string
  VSCODE_E2E_WORKSPACE_PATH?: string
  VSCODE_E2E_TRACE?: 'on' | 'off'
}

export const test = baseTest.extend<{ launch: LaunchFixture }>({
  launch: async ({ task }, use) => {
    const teardowns: (() => Promise<void>)[] = []

    await use(async (options) => {
      const executablePath = inject('executablePath')
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

      const tester = new VSCodeTester(page)

      async function step(name: string, fn: (context: Context) => Awaitable<void>) {
        await page.reload()
        try {
          await fn({ page, tester })
        }
        catch (err) {
          throw new Error(`Error during step "${name}"`, { cause: err })
        }
      }

      await tester.openTestTab()

      return { page, tester, step }
    })

    for (const teardown of teardowns)
      await teardown()
  },
})
