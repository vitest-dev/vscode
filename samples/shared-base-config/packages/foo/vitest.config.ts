import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      tags: [
        {
          description: 'Defined only in the package config.',
          name: 'leaf',
        },
      ],
    },
  }),
)
