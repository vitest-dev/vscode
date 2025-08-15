import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['./packages/extension/src/extension.ts'],
    external: ['vscode'],
    format: 'cjs',
    define: {
      'process.env.EXTENSION_NODE_ENV': JSON.stringify(process.env.EXTENSION_NODE_ENV || 'production'),
    },
  },
  {
    entry: {
      worker: './packages/extension/src/worker/index.ts',
    },
    format: 'cjs',
  },
  {
    entry: {
      workerLegacy: './packages/worker-legacy/src/index.ts',
      workerNew: './packages/worker/src/index.ts',
    },
    format: 'cjs',
  },
  {
    entry: ['./packages/extension/src/worker/setupFile.ts'],
    external: ['vitest'],
    format: 'esm',
  },
])
