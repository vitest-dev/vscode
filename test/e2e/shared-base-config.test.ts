import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { beforeAll, vi } from 'vitest'
import { test } from './utils/helper'

// Vitest extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

async function openFileViaQuickOpen(page: Page, fileName: string) {
  await page.keyboard.press('ControlOrMeta+P')
  await page.keyboard.type(fileName)
  // pressing Enter would race the async population of the result list
  const row = page.locator('.quick-input-widget .monaco-list-row', { hasText: fileName }).first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  await row.click()
  await page
    .locator('.tabs-container .tab', { hasText: fileName })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
}

// https://github.com/vitest-dev/vscode/issues/799
test('gutter run uses the most specific config, not the shared base config', async ({
  launch,
  logPath,
}) => {
  const { page, tester } = await launch({
    workspacePath: './samples/shared-base-config',
  })

  // wait until both discovered configs are resolved
  await vi.waitUntil(
    () => {
      try {
        const log = readFileSync(logPath, 'utf-8')
        return (
          log.includes('Watching vitest.config.base.ts') &&
          log.includes('Watching packages/foo/vitest.config.ts')
        )
      } catch {
        return false
      }
    },
    { timeout: 60_000 },
  )

  await openFileViaQuickOpen(page, 'which-config.test.ts')

  const glyph = page.locator('.glyph-margin-widgets .testing-run-glyph').first()
  await glyph.waitFor({ state: 'visible', timeout: 60_000 })
  await glyph.click()

  // the test only passes under packages/foo/vitest.config.ts;
  // if the shared base config ran it instead, the summary shows 0/1
  await expect(tester.tree.getResultsLocator()).toHaveText('1/1', { timeout: 30_000 })
})
