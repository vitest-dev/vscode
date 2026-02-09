import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const AGENTS = [
  'npm',
  'yarn',
  'yarn@berry',
  'pnpm',
  'pnpm@6',
  'bun',
  'deno',
]

const LOCKS = {
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'deno.lock': 'deno',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
}

function pathExists(path: string, type: 'file' | 'directory') {
  try {
    const stat = statSync(path)
    return type === 'file' ? stat.isFile() : stat.isDirectory()
  }
  catch {
    return false
  }
}

export function detectPackageManager(cwd: string) {
  const strategies = ['lockfile', 'packageManager-field', 'devEngines-field']
  for (const directory of lookup(cwd)) {
    for (const strategy of strategies) {
      switch (strategy) {
        case 'lockfile': {
          for (const lock of Object.keys(LOCKS)) {
            if (pathExists(path.join(directory, lock), 'file')) {
              const name = LOCKS[lock as 'bun.lock']
              const result = parsePackageJson(path.join(directory, 'package.json'))
              if (result)
                return result
              else
                return { name, agent: name }
            }
          }
          break
        }
        case 'packageManager-field':
        case 'devEngines-field': {
          const result = parsePackageJson(path.join(directory, 'package.json'))
          if (result)
            return result
          break
        }
      }
    }
  }
  return null
}

function parsePackageJson(filepath: string) {
  if (!filepath || !pathExists(filepath, 'file'))
    return null
  return handlePackageManager(filepath)
}

function* lookup(cwd = process.cwd()) {
  let directory = path.resolve(cwd)
  const { root } = path.parse(directory)
  while (directory && directory !== root) {
    yield directory
    directory = path.dirname(directory)
  }
}

function handlePackageManager(filepath: string) {
  try {
    const content = readFileSync(filepath, 'utf8')
    const pkg = JSON.parse(content)
    let agent
    const nameAndVer = getNameAndVer(pkg)
    if (nameAndVer) {
      const name = nameAndVer.name
      const ver = nameAndVer.ver
      let version = ver
      if (name === 'yarn' && ver && Number.parseInt(ver) > 1) {
        agent = 'yarn@berry'
        version = 'berry'
        return { name, agent, version }
      }
      else if (name === 'pnpm' && ver && Number.parseInt(ver) < 7) {
        agent = 'pnpm@6'
        return { name, agent, version }
      }
      else if (AGENTS.includes(name)) {
        agent = name
        return { name, agent, version }
      }
      else {
        return null
      }
    }
  }
  catch {
  }
  return null
}

function getNameAndVer(pkg: any) {
  const handelVer = (version: string) => version?.match(/\d+(\.\d+){0,2}/)?.[0] ?? version
  if (typeof pkg.packageManager === 'string') {
    const [name, ver] = pkg.packageManager.replace(/^\^/, '').split('@')
    return { name, ver: handelVer(ver) }
  }
  if (typeof pkg.devEngines?.packageManager?.name === 'string') {
    return {
      name: pkg.devEngines.packageManager.name,
      ver: handelVer(pkg.devEngines.packageManager.version),
    }
  }
  return void 0
}
