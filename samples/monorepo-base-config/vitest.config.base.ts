import { defineConfig } from 'vitest/config'

// shared base config - defines NO tags, they only live in the package config
export default defineConfig({
  test: {
    environment: 'node',
  },
})
