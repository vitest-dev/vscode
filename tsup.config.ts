import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
  },
  {
    entry: ['./src/worker/worker.ts', './src/worker/debug.ts'],
    format: 'cjs',
  },
  {
    entry: ['./src/worker/setupFile.ts'],
    external: ['vitest'],
    format: 'esm',
  },
])
