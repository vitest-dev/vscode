import { launch } from '@hiogawa/vscode-e2e'
import { test } from 'vitest'
import type { Page } from 'playwright'

export function createVscodeTest({
  extensionPath,
  workspacePath,
  trace,
}: {
  extensionPath?: string;
  workspacePath?: string;
  trace?: boolean;
}) {
  return test.extend<{ page: Page }>({
    page: async ({ task }, use) => {
      const { app } = await launch({
        extensionPath,
        workspacePath,
      })
      const page = await app.firstWindow()
      if (trace) {
        await page.context().tracing.start({ screenshots: true, snapshots: true })
      }
      await use(page)
      if (trace) {
        await page.context().tracing.stop({ path: `test-results/${task.id}/basic.zip` })
      }
      await app.close()
    },
  })
}
