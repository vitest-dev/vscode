import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
  files: 'test/unit/**/*.test.ts',
  mocha: {
    ui: 'bdd',
    preload: 'tsx/cjs',
  },
})
