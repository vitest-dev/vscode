import type { NamedBlock } from './parsers/parser_nodes'

export function transformTestPattern(block: NamedBlock): string {
  // Vitest's test name pattern is a regex, so we need to escape any special regex characters.
  // Additionally, when a custom start process is not used on Windows, child_process.spawn is used with shell: true.
  // That disables automatic quoting/escaping of arguments, requiring us to manually perform that here as well.
  let result = block.name!.replace(/[$^+?()[\]"]/g, '\\$&')
  // https://vitest.dev/api/#test-each
  // replace vitest's table test placeholder and treat it as regex
  if (block.lastProperty === 'each')
    result = result.replace(/%[sdifr#%]/g, () => '.+')
  return result
}

