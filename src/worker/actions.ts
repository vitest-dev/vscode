import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join } from 'pathe'
import type { CoverageProvider, Vitest } from 'vitest'
import type { BirpcMethods } from '../api/rpc'

const _require = require

const inspector = () => _require('inspector') as typeof import('inspector')

interface WatchState {
  files: string[]
  testNamePattern: string | undefined
  watchEveryFile: boolean
  rerunTriggered: boolean
}

export function createWorkerMethods(vitestById: Record<string, Vitest>): BirpcMethods {
  let debuggerEnabled = false

  const watchStateById: Record<string, WatchState | null> = {}
  const providers = new WeakMap<Vitest, CoverageProvider>()
  const coverages = new WeakMap<Vitest, unknown>()
  const coverageStatuses = new WeakMap<Vitest, boolean>()

  const vitestEntries = Object.entries(vitestById)
  vitestEntries.forEach(([id, vitest]) => {
    vitest.getCoreWorkspaceProject().provide('__vscode', {
      get continuousFiles() {
        const state = watchStateById[id]
        return state?.files || []
      },
      get watchEveryFile() {
        const state = watchStateById[id]
        return state?.watchEveryFile ?? true
      },
      get rerunTriggered() {
        const state = watchStateById[id]
        return state?.rerunTriggered ?? false
      },
    })

    // @ts-expect-error modifying a private property
    const originalScheduleRerun = vitest.scheduleRerun.bind(vitest)
    // @ts-expect-error modifying a private property
    vitest.scheduleRerun = async function (files: string[]) {
      // if trigger is not a test file, remove all non-continious files from  this.changedTests
      const triggerFile = files[0]
      const isTestFileTrigger = this.changedTests.has(triggerFile)

      const state = watchStateById[id]

      // no continuous files for this Vitest instance, just collect tests
      if (!state) {
        // do not run any tests if continuous run was not enabled
        if (!isTestFileTrigger) {
          this.changedTests.clear()
          this.invalidates.clear()
        }

        vitest.configOverride.testNamePattern = /$a/
        return await originalScheduleRerun.call(this, files)
      }

      state.rerunTriggered = true

      vitest.configOverride.testNamePattern = state.testNamePattern ? new RegExp(state.testNamePattern) : undefined
      if (state.watchEveryFile)
        return await originalScheduleRerun.call(this, files)

      if (!isTestFileTrigger) {
        // if souce code is changed and related tests are not continious, remove them from changedTests
        const updatedTests = new Set<string>()
        for (const file of this.changedTests) {
          if (state.files.includes(file))
            updatedTests.add(file)
        }
        this.changedTests = updatedTests
      }

      return await originalScheduleRerun.call(this, files)
    }
  })

  async function rerunTests(vitest: Vitest, files: string[]) {
    await vitest.report('onWatcherRerun', files)
    await vitest.runFiles(files.flatMap(file => vitest.getProjectsByTestFile(file)), false)

    await vitest.report('onWatcherStart', vitest.state.getFiles(files))
  }

  async function runTests(id: string, files: string[], testNamePattern?: string) {
    const cwd = process.cwd()
    const vitest = vitestById[id]
    const state = watchStateById[id]
    if (state)
      state.rerunTriggered = false

    process.chdir(dirname(id))
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

  async function globTestFiles(id: string, vitest: Vitest, filters?: string[]) {
    const cwd = process.cwd()
    process.chdir(dirname(id))
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
        rerunTriggered: false,
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
      vitest.config.coverage.enabled = false
      vitest.coverageProvider = undefined
      try {
        await runTests(id, [testFile], '$a')
      }
      finally {
        vitest.configOverride.testNamePattern = undefined
        vitest.coverageProvider = coverageStatuses.get(vitest) ? providers.get(vitest) : undefined
        vitest.config.coverage.enabled = coverageStatuses.get(vitest) || false
      }
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

      // @ts-expect-error private method
      await vitest.initBrowserProviders()

      if (testNamePattern) {
        await runTests(id, files || vitest.state.getFilepaths(), testNamePattern)
      }
      else {
        const specs = await globTestFiles(id, vitest, files)
        await runTests(id, specs.map(([_, spec]) => spec))
      }
    },
    async getFiles(id: string) {
      const vitest = vitestById[id]
      const files = await globTestFiles(id, vitest)
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
    async enableCoverage(id: string) {
      const vitest = vitestById[id]
      coverages.delete(vitest)
      vitest.config.coverage.enabled = true
      coverageStatuses.set(vitest, true)

      const jsonReporter = vitest.config.coverage.reporter.find(([name]) => name === 'json')
      vitest.config.coverage.reporter = jsonReporter ? [jsonReporter] : [['json', {}]]
      vitest.config.coverage.reportOnFailure = true
      vitest.config.coverage.reportsDirectory = join(tmpdir(), `vitest-coverage-${randomUUID()}`)

      try {
        if (!providers.has(vitest)) {
          // @ts-expect-error private method
          await vitest.initCoverageProvider()
          await vitest.coverageProvider?.clean(vitest.config.coverage.clean)
          providers.set(vitest, vitest.coverageProvider!)
        }
        else {
          vitest.coverageProvider = providers.get(vitest)
          await vitest.coverageProvider?.clean(vitest.config.coverage.clean)
        }
      }
      catch (err) {
        coverageStatuses.set(vitest, false)
        vitest.config.coverage.enabled = false
        throw err
      }
    },
    disableCoverage(id: string) {
      const vitest = vitestById[id]
      coverages.delete(vitest)
      coverageStatuses.set(vitest, false)
      vitest.config.coverage.enabled = false
      vitest.coverageProvider = undefined
    },
    async getCoverageConfig(id: string) {
      const vitest = vitestById[id]
      return vitest.config.coverage
    },
    async waitForCoverageReport(id: string) {
      const vitest = vitestById[id]
      const coverage = vitest.config.coverage
      if (!coverage.enabled || !vitest.coverageProvider)
        return null
      await vitest.runningPromise
      if (existsSync(coverage.reportsDirectory))
        return coverage.reportsDirectory
      return null
    },
    startInspect(port) {
      inspector().open(port)
      debuggerEnabled = true
    },
    stopInspect() {
      debuggerEnabled = false
      inspector().close()
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
