import type { BirpcMethods } from '../api/rpc'
import type { Vitest } from './vitest'

export function createWorkerMethods(vitestById: Record<string, Vitest>): BirpcMethods {
  function vitest(id: string) {
    const vitest = vitestById[id]
    if (!vitest)
      throw new Error(`Vitest instance not found with id: ${id}`)
    return vitest
  }

  return {
    async watchTests(id: string, files, testNamePattern) {
      const { watcher } = vitest(id)
      if (!files)
        watcher.trackEveryFile()
      else
        watcher.trackTests(files, testNamePattern)
    },
    async unwatchTests(id) {
      vitest(id).watcher.stopTracking()
    },
    async collectTests(id: string, testFiles: string[]) {
      return vitest(id).collectTests(testFiles)
    },
    async cancelRun(id: string) {
      await vitest(id).cancelRun()
    },
    async runTests(id, files, testNamePattern) {
      return vitest(id).runTests(files, testNamePattern)
    },
    async getFiles(id: string) {
      return vitest(id).getFiles()
    },
    isTestFile(file: string) {
      for (const id in vitestById) {
        if (vitestById[id].isTestFile(file))
          return true
      }
      return false
    },
    async enableCoverage(id: string) {
      const vitest = vitestById[id]
      return vitest.coverage.enable()
    },
    disableCoverage(id: string) {
      return vitest(id).coverage.disable()
    },
    async waitForCoverageReport(id: string) {
      return vitest(id).coverage.waitForCoverageReport()
    },
    startInspect(id, port) {
      vitest(id).debugger.start(port)
    },
    stopInspect(id) {
      vitest(id).debugger.stop()
    },
    async close() {
      for (const vitest in vitestById) {
        try {
          await vitestById[vitest].dispose()
        }
        catch {
          // ignore
        }
      }
    },
  }
}
