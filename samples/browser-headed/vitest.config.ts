/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    target: 'es2020',
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/ignored.test.ts'],
    // This is needed for debugger connection to browser tests
    fileParallelism: false,
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
    }
  },
})
