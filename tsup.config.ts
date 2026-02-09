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
    },
    format: 'cjs',
  },
  {
    entry: {
      workerNew: './packages/worker/src/index.ts',
    },
    format: 'cjs',
  },
  {
    entry: ['./packages/extension/src/worker/browserSetupFile.ts'],
    external: ['vitest', '@vitest/browser/context'],
    format: 'esm',
  },
])
