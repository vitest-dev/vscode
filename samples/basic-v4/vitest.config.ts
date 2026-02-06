/// <reference types="vitest/config" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from 'vite'

export default defineConfig({
  esbuild: {
    target: 'es2022',
  },
  test: {
    include: ['src/should_included_test.ts', 'test/**/*.test.ts'],
    exclude: ['test/ignored.test.ts'],
  },
})
