import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['**/*.test.ts'],
      tags: [{ name: 'leaf-only' }],
    },
  }),
)
