import { defineConfig } from 'vitest/config'

// to open playwright inspector either run with `PWDEBUG`
//   PWDEBUG=1 pnpm test-e2e
//
// or use `page.pause` inside a test code
//   await page.pase()

export default defineConfig({
  test: {
    // use Infinity on local for `page.pause()`
    testTimeout: process.env.CI ? 60_000 : Number.POSITIVE_INFINITY,
    fileParallelism: false,
    env: {
      VSCODE_E2E_EXTENSION_PATH: './',
      VSCODE_E2E_TRACE: 'on',
    },
  },
})
