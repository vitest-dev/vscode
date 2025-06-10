import versionBump from 'bumpp'
import c from 'picocolors'
import prompts from 'prompts'
import { SemVer } from 'semver'
import { version } from '../package.json'

// vscode support _only_ major.minor.patch, it doesn't support -beta.1
const versionNumbers = version.split('.')
const currentVersion = versionNumbers.slice(0, 3).join('.')
const currentMinor = versionNumbers[1]
const isCurrentlyPreRelease = Number(currentMinor) % 2 !== 0

const PADDING = 13

const major = new SemVer(currentVersion).inc('major').version
const semverMinor = new SemVer(currentVersion).inc('minor').version
const semverTwoMinor = new SemVer(currentVersion).inc('minor').inc('minor').version
const patch = new SemVer(currentVersion).inc('patch').version

const minor = isCurrentlyPreRelease ? semverMinor : semverTwoMinor
const preminor = isCurrentlyPreRelease ? semverTwoMinor : semverMinor

const result = await prompts([
  {
    type: 'autocomplete',
    name: 'release',
    message: `Current version ${c.green(currentVersion)}`,
    initial: 'next',
    choices: [
      { value: major, title: `${'major'.padStart(PADDING, ' ')} ${c.bold(major)}` },
      { value: minor, title: `${'minor'.padStart(PADDING, ' ')} ${c.bold(minor)}` },
      { value: preminor, title: `${'pre-minor'.padStart(PADDING, ' ')} ${c.bold(preminor)} (odd number)` },
      { value: patch, title: `${(isCurrentlyPreRelease ? 'pre-patch' : 'patch').padStart(PADDING, ' ')} ${c.bold(patch)}` },
      { value: currentVersion, title: `${'as-is'.padStart(PADDING, ' ')} ${c.bold(currentVersion)}` },
    ],
  },
])

if (!result.release)
  process.exit(0)

await versionBump({
  release: result.release,
  commit: true,
  push: true,
  tag: true,
  interface: false,
  confirm: true,
})
