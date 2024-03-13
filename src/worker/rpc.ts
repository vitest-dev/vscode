import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api/rpc'

const _require = require

export function createWorkerRPC(vitest: Vitest[], channel: ChannelOptions) {
  const vitestByFolder = vitest.reduce((acc, vitest) => {
    acc[vitest.config.root] = vitest
    return acc
  }, {} as Record<string, Vitest>)
  const vitestEntries = Object.entries(vitestByFolder)
  const rpc = createBirpc<BirpcEvents, BirpcMethods>({
    async collectTests(workspaceFolder: string, testFile: string) {
      const vitest = vitestByFolder[workspaceFolder]
      vitest.configOverride.testNamePattern = /$a/ // force to skip all tests
      await vitest.rerunFiles([testFile])
    },
    async cancelRun() {
      for (const [, vitest] of vitestEntries)
        vitest.cancelCurrentRun('keyboard-input')
    },
    async runFiles() {
      for (const [_, vitest] of vitestEntries) {
        vitest.configOverride.testNamePattern = undefined
        const specs = await vitest.globTestFiles()
        const files = specs.map(([_, spec]) => spec)
        await vitest.rerunFiles(files)
      }
    },
    async runFolderFiles(folder, files, testNamePattern) {
      const vitest = vitestByFolder[folder]
      if (!vitest)
        return
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
    async getFiles() {
      const filesByFolder = await Promise.all(vitestEntries.map(async ([folder, vitest]) => {
        const files = await vitest.globTestFiles()
        // reset cached test files list
        vitest.projects.forEach((project) => {
          project.testFilesList = null
        })
        return [folder, files.map(([_, spec]) => spec)] as [string, string[]]
      }))
      return Object.fromEntries(filesByFolder)
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
