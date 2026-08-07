import { readFileSync } from 'node:fs'
import { beforeAll, vi } from 'vitest'
import { test } from './utils/helper'

// Vitest extension doesn't work with CI flag
beforeAll(() => {
  delete process.env.CI
  delete process.env.GITHUB_ACTIONS
})

// https://github.com/vitest-dev/vscode/issues/799
test('collection identifies the selected profile when configs overlap', async ({
  launch,
  logPath,
}) => {
  const { tester } = await launch({
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

  await tester.tree.expand('packages/foo/test/tagged.test.ts')

  // Opening the file collects it through the first, root config. The tag exists
  // only in the package config, so collection fails before a gutter action exists.
  await vi.waitUntil(
    () =>
      readFileSync(logPath, 'utf-8').includes(
        'Vitest used the "shared-base-config:vitest.config.base.ts" profile for this test.',
      ),
    { timeout: 30_000 },
  )
})
