/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser/providers/playwright'

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
      provider: playwright(),
      instances: [
        { browser: 'chromium' },
      ],
    }
  },
})
