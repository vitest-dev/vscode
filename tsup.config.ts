import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
  },
  {
    entry: ['./src/worker/worker.ts'],
    format: 'esm',
  },
  {
    entry: ['./src/worker/debug.ts'],
    format: 'esm',
  },
])
