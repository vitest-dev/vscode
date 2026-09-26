import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['z-leaf/**/*.test.ts'],
  },
})
