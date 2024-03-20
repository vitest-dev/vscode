import process from 'node:process'
import { $ } from 'execa'

// TODO: fix test-e2e

if (process.env.CI === 'true' && process.platform === 'linux')
  await $`xvfb-run --auto-servernum --server-args=-screen\\ 0\\ 1024x768x24 pnpm test`
  // await $`xvfb-run --auto-servernum --server-args=-screen\\ 0\\ 1024x768x24 pnpm test-e2e --retry 2`
else
  await $`pnpm test`
  // await $`pnpm test-e2e`
