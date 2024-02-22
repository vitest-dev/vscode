import type { ChannelOptions } from 'birpc'
import { createBirpc } from 'birpc'
import type { Vitest } from 'vitest'
import type { BirpcEvents, BirpcMethods } from './api'

export function createWorkerRPC(vitest: Vitest, channel: ChannelOptions) {
  const rpc = createBirpc<BirpcEvents, BirpcMethods>({
    async runFiles(files, testNamePattern) {
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
      const files = await vitest.globTestFiles()
      return files.map(([_, spec]) => spec)
    },
    async getConfig() {
      const config = vitest.getCoreWorkspaceProject().getSerializableConfig()
      return config
    },
    async terminate() {
      await vitest.close()
    },
    async isTestFile(file: string) {
      for (const project of vitest.projects) {
        if (project.isTestFile(file))
          return true
      }
      return false
    },
  }, {
    eventNames: [
      'onReady',
      'onError',
      'onConsoleLog',
      'onTaskUpdate',
      'onFinished',
      'onCollected',
    ],
    ...channel,
  })
  return rpc
}

export function createErrorRPC(channel: ChannelOptions) {
  return createBirpc<BirpcEvents>({}, {
    eventNames: ['onError'],
    ...channel,
  })
}
