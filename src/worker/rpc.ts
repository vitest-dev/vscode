import { createRequire } from 'node:module'
import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from '../api'

const _require = createRequire(__filename)

export function createWorkerRPC(vitest: Vitest[], channel: ChannelOptions) {
  const vitestByFolder = vitest.reduce((acc, vitest) => {
    acc[vitest.config.root] = vitest
    return acc
  }, {} as Record<string, Vitest>)
  const vitestEntries = Object.entries(vitestByFolder)
  const rpc = createBirpc<BirpcEvents, BirpcMethods>({
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
        await vitest.changeNamePattern('', files)
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
        return [folder, files.map(([_, spec]) => spec)] as [string, string[]]
      }))
      return Object.fromEntries(filesByFolder)
    },
    async getTestMetadata(file: string) {
      for (const [folder, vitest] of vitestEntries) {
        for (const project of vitest.projects) {
          if (project.isTestFile(file)) {
            return {
              folder,
            }
          }
        }
      }
      return null
    },
    startInspect(port) {
      _require('inspector').open(port)
      // TODO: force pool to be non-parallel?
    },
    stopInspect() {
      _require('inspector').close()
    },
  }, {
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
