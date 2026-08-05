import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.base'

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      tags: [
        {
          description: 'A tag that is only defined in the package config.',
          name: 'integration',
        },
      ],
    },
  }),
)
