export function transformTestPattern({ testName, isEach }: { testName: string; isEach: boolean }): string {
  // Vitest's test name pattern is a regex, so we need to escape any special regex characters.
  // Additionally, when a custom start process is not used on Windows, child_process.spawn is used with shell: true.
  // That disables automatic quoting/escaping of arguments, requiring us to manually perform that here as well.
  let result = testName.replace(/[$^+?()[\]"]/g, '\\$&')
  // https://vitest.dev/api/#test-each
  // replace vitest's table test placeholder and treat it as regex
  if (isEach) {
    // replace \$value, \$obj.a with .+?
    result = result.replace(/\\\$[a-zA-Z_.]+/g, '.+?')
    // Integer or index of test case
    result = result.replace(/%[i#]/g, () => '\\d+?')
    // Float
    result = result.replace(/%[df]/g, () => '[\\d.eE+-]+?')
    // Arbitrary string
    result = result.replace(/%[sjo]/g, () => '.+?')
    // Single percent sign
    result = result.replace(/%%/g, () => '%')
  }
  return result
}
