/// <reference types="vitest" />
/// <reference types="@vitest/browser/providers/playwright" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    target: 'es2020',
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/ignored.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [
        {
          browser: 'chromium',
        },
        {
          browser: 'firefox',
          headless: false,
        },
      ]
    }
  },
})
