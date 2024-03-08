import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/extension.ts', './src/languageServer.ts'],
    external: ['vscode'],
    format: 'cjs',
  },
])
