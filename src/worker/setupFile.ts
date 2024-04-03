import type { WorkerGlobalState } from 'vitest'
import { inject } from 'vitest'

const { watchEveryFile, continuousFiles, rerunTriggered } = inject('__vscode')
// @ts-expect-error injected global
const workerState = globalThis.__vitest_worker__ as WorkerGlobalState

const testFile = workerState.filepath!

// don't run tests that are not watched if rerun was triggered - only collect those tests
if (rerunTriggered) {
  if (!watchEveryFile && !continuousFiles.includes(testFile))
    workerState.config.testNamePattern = /$a/
}
