import type { WorkspaceProject } from 'vitest/node'
import { relative } from 'pathe'
import { ExtensionWorker } from './worker'

export class ExtensionWorkerWatcher {
  private files: string[] = []
  private testNamePattern: string | undefined
  private watchEveryFile = false

  private enabled = false

  constructor(private worker: ExtensionWorker) {
    // eslint-disable-next-line ts/no-this-alias
    const state = this
    const vitest = worker.vitest

    // @ts-expect-error modifying a private property
    const originalScheduleRerun = vitest.scheduleRerun.bind(vitest)
    // @ts-expect-error modifying a private property
    vitest.scheduleRerun = async function (files: string[]) {
      // if trigger is not a test file, remove all non-continious files from this.changedTests
      const triggerFile = files[0]
      const isTestFileTrigger = this.changedTests.has(triggerFile)

      // no continuous files for this Vitest instance, just collect tests
      if (!state.enabled) {
        // do not run any tests if continuous run was not enabled
        if (!isTestFileTrigger) {
          this.changedTests.clear()
          this.invalidates.clear()
          return await originalScheduleRerun.call(this, [])
        }

        await state.collectTests(files, [...this.changedTests])
        return await originalScheduleRerun.call(this, [])
      }

      const namePattern = state.testNamePattern ? new RegExp(state.testNamePattern) : undefined
      worker.setGlobalTestNamePattern(namePattern)
      if (state.watchEveryFile) {
        vitest.logger.log(
          'Rerunning all tests due to file changes:',
          ...files.map(f => relative(vitest.config.root, f)),
          namePattern ? `with pattern ${namePattern}` : '',
        )
        return await originalScheduleRerun.call(this, files)
      }

      const changedFiles = [...this.changedTests]

      if (!isTestFileTrigger) {
        // if souce code is changed and related tests are not continious, remove them from changedTests
        const currentChanged = [...this.changedTests]
        this.changedTests.clear()
        for (const file of currentChanged) {
          if (state.isTestFileWatched(file))
            this.changedTests.add(file)
        }
      }
      // the other test file was edited, ignore it
      else if (!state.isTestFileWatched(triggerFile)) {
        this.changedTests.clear()
      }

      if (this.changedTests.size) {
        vitest.logger.log(
          'Rerunning tests due to file changes:',
          ...Array.from(this.changedTests, f => relative(vitest.config.root, f)),
          namePattern ? `with pattern ${namePattern}` : '',
        )
      }
      else {
        await state.collectTests(files, changedFiles)
      }

      return await originalScheduleRerun.call(this, files)
    }
  }

  private async collectTests(trigger: string[], tests: string[]) {
    const vitest = this.worker.vitest
    const specs = tests.flatMap(file => vitest.getProjectsByTestFile(file))
    const astSpecs: [project: WorkspaceProject, file: string][] = []

    for (const [project, file] of specs) {
      astSpecs.push([project, file])
    }

    this.worker.setGlobalTestNamePattern(ExtensionWorker.COLLECT_NAME_PATTERN)
    vitest.logger.log('Collecting tests due to file changes:', ...trigger.map(f => relative(vitest.config.root, f)))

    if (astSpecs.length) {
      vitest.logger.log('Collecting using AST explorer...')
      await this.worker.astCollect(astSpecs)
      vitest.changedTests.clear()
    }
  }

  private isTestFileWatched(testFile: string) {
    if (!this.files?.length)
      return false

    return this.files.some((file) => {
      if (file === testFile)
        return true
      if (file.at(-1) === '/')
        return testFile.startsWith(file)
      return false
    })
  }

  trackTests(files: string[], testNamePatern: string | undefined) {
    this.enabled = true
    this.files = files
    this.watchEveryFile = false
    this.testNamePattern = testNamePatern
  }

  trackEveryFile() {
    this.enabled = true
    this.watchEveryFile = true
    this.files = []
    this.testNamePattern = undefined
  }
}
