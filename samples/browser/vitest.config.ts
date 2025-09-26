/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const provider: any = process.env.TEST_LEGACY !== 'true'
    ? (await import('@vitest/browser/providers/playwright')).playwright()
    : 'playwright'
  return {
    esbuild: {
      target: 'es2020',
    },
    test: {
      include: ['test/**/*.test.ts'],
      exclude: ['test/ignored.test.ts'],
      browser: {
        enabled: true,
        headless: true,
        provider,
        instances: [
          { browser: 'chromium' },
        ],
      }
    },
  }
})
