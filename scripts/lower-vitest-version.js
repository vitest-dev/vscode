const { readFileSync, writeFileSync } = require('node:fs')

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
pkg.pnpm = {
  overrides: {
    '@vitest/browser': '^3.2.4',
    '@vitest/coverage': '^3.2.4',
    'vitest': '^3.2.4',
  },
}
writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
