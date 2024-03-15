import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    plugins: [nxViteTsPaths()],
    test: {
      env: {
        VITEST: "foo"
      },
      pool: 'forks',
      testTimeout: 60_000 * 3,
      maxConcurrency: 3,
      maxWorkers: 10,
      hookTimeout: 60_000 * 3,
      globals: true,
      environment: 'node',
      include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    },
    esbuild: {
      target: 'es2022'
    },
  }
])
