import process from 'node:process'
import { $ as $_ } from 'execa'

// TODO: fix test-e2e

const $ = $_({ stdio: 'inherit' })

if (process.env.CI === 'true' && process.platform === 'linux') {
  await $`xvfb-run --auto-servernum ${'--server-args=-screen 0 1024x768x24'} pnpm test`
  false && await $`xvfb-run --auto-servernum ${'--server-args=-screen 0 1024x768x24'} pnpm test-e2e --retry 2`
}
else {
  await $`pnpm test`
  false && await $`pnpm test-e2e`
}
