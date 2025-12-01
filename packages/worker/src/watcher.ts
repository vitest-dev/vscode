import type { ExtensionTestSpecification } from 'vitest-vscode-shared'
import type { TestSpecification, Vitest } from 'vitest/node'
import type { ExtensionWorkerRunner } from './runner'
import { createQueuedHandler } from 'vitest-vscode-shared'

export class ExtensionWorkerWatcher {
  private enabled = false
  private trackingEveryFile = false
  private trackedTestItems: Record<string, string[]> = {}
  private trackedDirectories: string[] = []

  constructor(vitest: Vitest, private runner: ExtensionWorkerRunner) {
    vitest.onFilterWatchedSpecification((specification) => {
      const shouldRun = this.shouldRunSpecification(specification)
      if (shouldRun) {
        return true
      }
      this.scheduleAstCollection(specification)
      return false
    })
  }

  private scheduleAstCollection = createQueuedHandler<TestSpecification>(async (specifications) => {
    await this.runner.collectSpecifications(specifications)
  })

  private shouldRunSpecification(specification: TestSpecification) {
    if (!this.enabled) {
      return false
    }

    if (this.trackingEveryFile) {
      return true
    }

    if (this.isTestFileWatched(specification.moduleId, this.trackedDirectories)) {
      return true
    }

    const project = specification.project.name
    const files = this.trackedTestItems[project]
    if (!files?.length) {
      return false
    }

    return files.includes(specification.moduleId)
  }

  trackTestItems(filesOrDirectories: ExtensionTestSpecification[] | string[]) {
    this.enabled = true
    if (typeof filesOrDirectories[0] === 'string') {
      this.trackedDirectories = filesOrDirectories as string[]
    }
    else {
      for (const [project, file] of filesOrDirectories) {
        if (!this.trackedTestItems[project]) {
          this.trackedTestItems[project] = []
        }
        this.trackedTestItems[project].push(file)
      }
    }
  }

  trackEveryFile(): void {
    this.enabled = true
    this.trackingEveryFile = true
  }

  stopTracking() {
    this.enabled = false
    this.trackingEveryFile = false
    this.trackedTestItems = {}
    this.trackedDirectories = []
  }

  private isTestFileWatched(testFile: string, files: string[]) {
    if (!files?.length)
      return false

    return files.some((file) => {
      if (file === testFile)
        return true
      if (file[file.length - 1] === '/')
        return testFile.startsWith(file)
      return false
    })
  }
}
