import type { WorkerGlobalState } from 'vitest'
import { inject } from 'vitest'
import { assert } from './utils'

const { watchEveryFile, continuousFiles, rerunTriggered } = inject('__vscode')
// @ts-expect-error injected global
const workerState = globalThis.__vitest_worker__ as WorkerGlobalState

const testFile = workerState.filepath!

assert(testFile, 'Expected workerState.filepath to be set')

// don't run tests that are not watched if rerun was triggered - only collect those tests
if (rerunTriggered) {
  if (!watchEveryFile && !testFileWatched())
    // eslint-disable-next-line regexp/no-useless-assertions
    workerState.config.testNamePattern = /$a/
}

function testFileWatched() {
  return continuousFiles.some((file) => {
    if (file === testFile)
      return true
    if (file[file.length - 1] === '/')
      return testFile.startsWith(file)
    return false
  })
}
