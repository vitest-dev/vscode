import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
  files: 'test/**/*.test.ts',
  mocha: {
    ui: 'bdd',
    preload: "./mocka.preload.cjs",
  },
})
