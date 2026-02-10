// @ts-check

import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      extension: './packages/extension/src/extension.ts',
      worker: './packages/extension/src/worker/index.ts',
      workerLegacy: './packages/worker-legacy/src/index.ts',
      workerNew: './packages/worker/src/index.ts',
    },
    external: ['vscode'],
    format: 'cjs',
    fixedExtension: false,
    inlineOnly: false,
    platform: 'node',
    define: {
      'process.env.EXTENSION_NODE_ENV': JSON.stringify(process.env.EXTENSION_NODE_ENV || 'production'),
    },
  },
  {
    entry: ['./packages/extension/src/worker/browserSetupFile.ts'],
    external: ['vitest', '@vitest/browser/context'],
    fixedExtension: false,
    inlineOnly: false,
    platform: 'node',
    format: 'esm',
  },
])
