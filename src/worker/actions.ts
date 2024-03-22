import { dirname } from 'pathe'
import type { Vitest } from 'vitest'
import type { BirpcMethods } from '../api/rpc'

const _require = require

export function createWorkerMethods(vitest: Vitest[]): BirpcMethods {
  let debuggerEnabled = false
  const vitestById = vitest.reduce((acc, vitest) => {
    acc[getId(vitest)] = vitest
    return acc
  }, {} as Record<string, Vitest>)

  const watchStateById: Record<string, {
    files: string[]
    testNamePattern: string | undefined
    watchEveryFile: boolean
  } | null> = {}

  vitest.forEach((vitest) => {
    const id = getId(vitest)
    // @ts-expect-error modifying a private property
    const originalScheduleRerun = vitest.scheduleRerun.bind(vitest)
    // @ts-expect-error modifying a private property
    vitest.scheduleRerun = async function (files: string[]) {
      // disable reruning on changes outside of the test files for now
      const tests = this.changedTests
      for (const file of files) {
        if (!tests.has(file))
          return
      }
      const state = watchStateById[id]
      // no continuous files for this Vitest instance, just collect tests
      if (!state) {
        vitest.configOverride.testNamePattern = /$a/
        return await originalScheduleRerun.call(this, files)
      }

      vitest.configOverride.testNamePattern = state.testNamePattern ? new RegExp(state.testNamePattern) : undefined
      if (state.watchEveryFile)
        return originalScheduleRerun.call(this, files)

      const allowedTests = state.files
      const testFilesToRun = new Set(tests)
      // remove tests that are not watched
      tests.forEach((file) => {
        if (!allowedTests.includes(file))
          testFilesToRun.delete(file)
      })

      // only collect tests, but don't run them
      if (!testFilesToRun.size)
        vitest.configOverride.testNamePattern = /$a/

      return originalScheduleRerun.call(this, files)
    }
  })

  const vitestEntries = Object.entries(vitestById)

  function getId(vitest: Vitest) {
    return vitest.server.config.configFile || vitest.config.workspace || vitest.config.root
  }

  async function rerunTests(vitest: Vitest, files: string[]) {
    await vitest.report('onWatcherRerun', files)
    await vitest.runFiles(files.flatMap(file => vitest.getProjectsByTestFile(file)), false)

    await vitest.report('onWatcherStart', vitest.state.getFiles(files))
  }

  async function runTests(vitest: Vitest, files: string[], testNamePattern?: string) {
    const cwd = process.cwd()
    process.chdir(dirname(getId(vitest)))
    try {
      vitest.configOverride.testNamePattern = testNamePattern ? new RegExp(testNamePattern) : undefined

      if (!debuggerEnabled) {
        await rerunTests(vitest, files)
      }
      else {
        for (const file of files)
          await rerunTests(vitest, [file])
      }
    }
    finally {
      process.chdir(cwd)
    }
  }

  async function globTestFiles(vitest: Vitest, filters?: string[]) {
    const cwd = process.cwd()
    process.chdir(dirname(getId(vitest)))
    const files = await vitest.globTestFiles(filters)
    process.chdir(cwd)
    return files
  }

  return {
    async watchTests(id: string, files, testNamePattern) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance not found with id: ${id}`)
      watchStateById[id] = {
        files: files || [],
        watchEveryFile: !files,
        testNamePattern,
      }
    },
    async unwatchTests(id) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance not found with id: ${id}`)
      watchStateById[id] = null
    },
    async collectTests(id: string, testFile: string) {
      const vitest = vitestById[id]
      await runTests(vitest, [testFile], '$a')
      vitest.configOverride.testNamePattern = undefined
    },
    async cancelRun(id: string) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance with id "${id}" not found.`)
      await vitest.cancelCurrentRun('keyboard-input')
    },
    async runTests(id, files, testNamePattern) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance not found for id: ${id}`)

      if (testNamePattern) {
        await runTests(vitest, files || vitest.state.getFilepaths(), testNamePattern)
      }
      else {
        const specs = await globTestFiles(vitest, files)
        await runTests(vitest, specs.map(([_, spec]) => spec))
      }
    },
    async getFiles(id: string) {
      const vitest = vitestById[id]
      const files = await globTestFiles(vitest)
      // reset cached test files list
      vitest.projects.forEach((project) => {
        project.testFilesList = null
      })
      return files.map(([project, spec]) => [project.config.name || '', spec])
    },
    async isTestFile(file: string) {
      for (const [_, vitest] of vitestEntries) {
        for (const project of vitest.projects) {
          if (project.isTestFile(file))
            return true
        }
      }
      return false
    },
    startInspect(port) {
      _require('inspector').open(port)
      debuggerEnabled = true
    },
    stopInspect() {
      debuggerEnabled = false
      _require('inspector').close()
    },
    async close() {
      for (const vitest of vitestEntries) {
        try {
          await vitest[1].close()
        }
        catch {
          // ignore
        }
      }
    },
  }
}
