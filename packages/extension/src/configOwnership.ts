import { dirname, isAbsolute, normalize, relative } from 'pathe'

/**
 * Number of path segments in the config's directory if the test file is inside
 * of it, or -1 if it is not. Higher means the config is closer to the test file.
 */
export function getConfigSpecificity(configFile: string | undefined, testFile: string): number {
  if (!configFile) {
    return -1
  }
  const configDir = dirname(normalize(configFile))
  const relativePath = relative(configDir, normalize(testFile))
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return -1
  }
  return configDir.split('/').filter(Boolean).length
}

export function isCloserConfig(
  candidateConfig: string | undefined,
  currentConfig: string | undefined,
  testFile: string,
): boolean {
  return (
    getConfigSpecificity(candidateConfig, testFile) > getConfigSpecificity(currentConfig, testFile)
  )
}
