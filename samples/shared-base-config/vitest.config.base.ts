import { defineConfig } from 'vitest/config'

// shared base config that is only meant to be merged into other configs,
// but still matches the extension's configGlob (#799)
export default defineConfig({
  test: {
    env: {
      CONFIG_NAME: 'base',
    },
  },
})
