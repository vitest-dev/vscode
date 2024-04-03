import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
  },
  {
    entry: ['./src/worker/worker.ts'],
    format: 'cjs',
  },
  {
    entry: ['./src/worker/setupFile.ts'],
    format: 'cjs',
  },
])
