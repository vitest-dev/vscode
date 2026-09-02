import process from 'node:process'
import { $ as $_ } from 'execa'

const $ = $_({ stdio: 'inherit', verbose: true })

async function main() {
  await $`pnpm -C samples/e2e i`
  await $`pnpm -C samples/monorepo-vitest-workspace i`
  await $`pnpm -C samples/browser i`
  await $`pnpm -C samples/imba i`

  // the ecosystem CI overrides every `@vitest/*` package with the latest
  // version, so the legacy worker (Vitest 3) cannot be built or tested there
  const unitTestArgs =
    process.env.SKIP_LEGACY === 'true' ? ['--ignore', 'test/unit/collect.test.ts'] : []

  if (process.env.CI === 'true' && process.platform === 'linux') {
    await $`xvfb-run pnpm test ${unitTestArgs}`
    await $`xvfb-run pnpm test-e2e --retry 2`
  } else {
    await $`pnpm test ${unitTestArgs}`
    await $`pnpm test-e2e`
  }
}

main()
