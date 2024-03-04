function escapeRegExp(str: string) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\\\^\|\.\$]/g, '\\$&')
}

const kReplacers = new Map<string, string>([
  ['%i', '\\d+?'],
  ['%#', '\\d+?'],
  ['%d', '[\\d.eE+-]+?'],
  ['%f', '[\\d.eE+-]+?'],
  ['%s', '.+?'],
  ['%j', '.+?'],
  ['%o', '.+?'],
  ['%%', '%'],
])

export function transformTestPattern(
  { testName, isEach }: { testName: string; isEach: boolean },
): string {
  // https://vitest.dev/api/#test-each
  // replace vitest's table test placeholder and treat it as regex
  let result = testName
  if (isEach) {
    // Replace object access patterns ($value, $obj.a) with %s first
    result = result.replace(/\$[a-zA-Z_.]+/g, '%s')
    result = escapeRegExp(result)
    // Replace percent placeholders with their respective regex
    result = result.replace(/%[i#dfsjo%]/g, m => kReplacers.get(m) || m)
  }
  else {
    result = escapeRegExp(result)
  }
  return result
}
