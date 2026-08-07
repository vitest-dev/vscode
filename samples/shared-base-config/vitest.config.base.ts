import { defineConfig } from 'vitest/config'

// Shared base config that is only meant to be merged into other configs,
// but still matches the extension's configGlob and defines no tags (#799).
export default defineConfig({
  test: {
    environment: 'node',
  },
})
