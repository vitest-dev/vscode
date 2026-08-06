import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      env: {
        CONFIG_NAME: 'leaf',
      },
    },
  }),
)
