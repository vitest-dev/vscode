import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'

const _require = require

export function createWorkerRPC(vitest: Vitest[], channel: ChannelOptions) {
  const vitestByFolder = vitest.reduce((acc, vitest) => {
    acc[vitest.server.config.configFile || vitest.config.root] = vitest
    return acc
  }, {} as Record<string, Vitest>)
  const vitestEntries = Object.entries(vitestByFolder)
  const rpc = createBirpc<BirpcEvents, BirpcMethods>({
    async collectTests(config: string, testFile: string) {
      const vitest = vitestByFolder[config]
      vitest.configOverride.testNamePattern = /$a/ // force to skip all tests
      await vitest.rerunFiles([testFile])
    },
    async cancelRun(config: string) {
      await vitestByFolder[config]?.cancelCurrentRun('keyboard-input')
    },
    async runFolderFiles(config, files, testNamePattern) {
      const vitest = vitestByFolder[config]
      if (!vitest)
        throw new Error(`Vitest instance not found for config: ${config}`)

      if (testNamePattern) {
        await vitest.changeNamePattern(testNamePattern, files)
      }
      else if (files?.length) {
        // running all files inside a single folder
        if (files.length === 1 && files[0][files[0].length - 1] === '/') {
          vitest.filenamePattern = files[0]
          vitest.configOverride.testNamePattern = undefined
          const specs = await vitest.globTestFiles()
          const filteredSpecs = specs.map(([_, spec]) => spec).filter(file => file.startsWith(files[0]))
          await vitest.rerunFiles(filteredSpecs)
        }
        else {
          await vitest.changeNamePattern('', files)
        }
      }
      else {
        vitest.configOverride.testNamePattern = undefined

        const specs = await vitest.globTestFiles()
        const files = specs.map(([_, spec]) => spec)
        await vitest.rerunFiles(files)
      }
    },
    async getFiles(config: string) {
      const vitest = vitestByFolder[config]
      const files = await vitest.globTestFiles()
      // reset cached test files list
      vitest.projects.forEach((project) => {
        project.testFilesList = null
      })
      return files.map(([_, spec]) => spec)
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
    },
    stopInspect() {
      _require('inspector').close()
    },
  }, {
    timeout: -1,
    eventNames: [
      'onConsoleLog',
      'onTaskUpdate',
      'onFinished',
      'onCollected',
    ],
    ...channel,
  })
  return rpc
}
