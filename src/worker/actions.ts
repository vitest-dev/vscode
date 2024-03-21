import { dirname } from 'pathe'
import type { Vitest } from 'vitest'
import type { BirpcMethods } from '../api/rpc'

const _require = require

export function createWorkerMethods(vitest: Vitest[]): BirpcMethods {
  const continuousFiles = new Set<string>()
  let continuesFullRun = false

  let debuggerEnabled = false
  const vitestById = vitest.reduce((acc, vitest) => {
    acc[getId(vitest)] = vitest
    return acc
  }, {} as Record<string, Vitest>)
  const vitestEntries = Object.entries(vitestById)

  function getId(vitest: Vitest) {
    return vitest.server.config.configFile || vitest.config.workspace || vitest.config.root
  }

  function disableWatch(vitest: Vitest) {
    vitest.watchTests(['/non-existing-name$^/'])
  }

  function watchEverything(vitest: Vitest) {
    vitest.watchTests([])
  }

  // start by disabling all watchers
  for (const instance of vitest)
    disableWatch(instance)

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
    async collectTests(id: string, testFile: string) {
      const vitest = vitestById[id]
      await runTests(vitest, [testFile], '$a')
      vitest.configOverride.testNamePattern = undefined
    },
    async cancelRun(id: string, files: string[], continuous) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance with id "${id}" not found.`)

      if (continuous) {
        if (!files.length)
          continuesFullRun = false
        else
          files.forEach(file => continuousFiles.delete(file))
      }

      // we put a non existing file to avoid watching all files
      if (!continuesFullRun && !continuousFiles.size)
        disableWatch(vitest)
      else if (continuesFullRun)
        watchEverything(vitest)
      else
        vitest.watchTests(Array.from(continuousFiles))

      await vitest.cancelCurrentRun('keyboard-input')
    },
    async runTests(id, files, testNamePattern, continuous) {
      const vitest = vitestById[id]
      if (!vitest)
        throw new Error(`Vitest instance not found for config: ${id}`)

      if (continuous) {
        if (!files) {
          continuesFullRun = true
          watchEverything(vitest)
        }
        else {
          files.forEach(file => continuousFiles.add(file))
          vitest.watchTests(Array.from(continuousFiles))
        }
      }

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
