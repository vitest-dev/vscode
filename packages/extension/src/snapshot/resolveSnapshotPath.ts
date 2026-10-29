import { basename, dirname, join } from 'pathe'

export const defaultSnapshotDir = '__snapshots__'

/**
 * Default Vitest snapshot location next to the test file:
 * `<testDir>/__snapshots__/<testBasename>.snap`.
 *
 * A custom `resolveSnapshotPath` or snapshot environment from the Vitest config
 * is not supported.
 */
export function resolveSnapshotPath(testFile: string, snapshotDir = defaultSnapshotDir): string {
  return join(dirname(testFile), snapshotDir, `${basename(testFile)}.snap`)
}
