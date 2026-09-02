// @ts-check

import { defineConfig } from 'tsdown'

// The legacy worker bundles Vitest 3 packages. Set SKIP_LEGACY=true to leave it
// out of the build, e.g. in the Vitest ecosystem CI where every `@vitest/*`
// package is overridden with the latest version.
const skipLegacy = process.env.SKIP_LEGACY === 'true'

export default defineConfig([
  {
    entry: {
      extension: './packages/extension/src/extension.ts',
      worker: './packages/extension/src/worker/index.ts',
      ...(skipLegacy ? {} : { workerLegacy: './packages/worker-legacy/src/index.ts' }),
      workerNew: './packages/worker/src/index.ts',
    },
    external: ['vscode'],
    format: 'cjs',
    fixedExtension: false,
    inlineOnly: false,
    platform: 'node',
    define: {
      'process.env.EXTENSION_NODE_ENV': JSON.stringify(
        process.env.EXTENSION_NODE_ENV || 'production',
      ),
    },
  },
  {
    entry: [
      './packages/extension/src/worker/browserSetupFile.ts',
      './packages/extension/src/worker/browserSetupFileLegacy.ts',
    ],
    external: ['vitest', '@vitest/browser/context', 'vitest/browser'],
    fixedExtension: false,
    inlineOnly: false,
    platform: 'node',
    format: 'esm',
  },
])
