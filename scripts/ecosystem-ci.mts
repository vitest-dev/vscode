import process from 'node:process'
import { $ as $_ } from 'execa'

const $ = $_({ stdio: 'inherit', verbose: true })

async function main() {
  await $`pnpm -C samples/e2e i`
  await $`pnpm -C samples/monorepo-vitest-workspace i`
  await $`pnpm -C samples/browser i`
  await $`pnpm -C samples/imba i`

  // setup pakcage overrides for samples used by test-e2e
  if (process.env.CI === 'true' && process.platform === 'linux') {
    await $`xvfb-run pnpm test`
    await $`xvfb-run pnpm test-e2e --retry 2`
  }
  else {
    await $`pnpm test`
    await $`pnpm test-e2e`
  }
}

main()
