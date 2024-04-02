import process from 'node:process'
import fs from 'node:fs'
import { $ as $_ } from 'execa'

const $ = $_({ stdio: 'inherit', verbose: true })

async function main() {
  // setup pakcage overrides for samples used by test-e2e
  const pkg = await readJson('package.json')
  if (pkg.pnpm?.overrides) {
    // pnpm
    await editJson('samples/e2e/package.json', (pkg2) => {
      pkg2.pnpm = pkg.pnpm
      return pkg2
    })
    await $({ cwd: 'samples/e2e' })`pnpm i --no-frozen-lockfile`

    // npm
    await editJson('samples/imba/package.json', (pkg2) => {
      for (const dep in pkg.pnpm.overrides) {
        if (dep in pkg2.devDependencies)
          pkg2.devDependencies[dep] = pkg.pnpm.overrides[dep]
      }
      pkg2.overrides = pkg.pnpm.overrides
      return pkg2
    })
    await $({ cwd: 'samples/imba' })`npm i`
  }

  if (process.env.CI === 'true' && process.platform === 'linux') {
    await $`xvfb-run pnpm test`
    await $`xvfb-run pnpm test-e2e --retry 2`
  }
  else {
    await $`pnpm test`
    await $`pnpm test-e2e`
  }
}

async function readJson(file: string) {
  return JSON.parse(await fs.promises.readFile(file, 'utf-8'))
}

async function editJson(file: string, edit: (data: any) => any) {
  const data = await readJson(file)
  await fs.promises.writeFile(file, JSON.stringify(edit(data), null, 2))
}

main()
