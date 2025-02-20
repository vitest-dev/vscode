import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
    define: {
      'process.env.EXTENSION_NODE_ENV': JSON.stringify(process.env.EXTENSION_NODE_ENV || 'production'),
    },
  },
  {
    entry: {
      worker: './src/worker/index.ts',
    },
    format: 'cjs',
  },
  {
    entry: ['./src/worker/setupFile.ts'],
    external: ['vitest'],
    format: 'esm',
  },
])
