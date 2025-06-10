import type { ProvidedContext } from 'vitest'
import type { WorkspaceProject } from 'vitest/node'
import { relative } from 'pathe'
import { ExtensionWorker } from './worker'

export class ExtensionWorkerWatcher {
  private files: string[] = []
  private testNamePattern: string | undefined
  private watchEveryFile = false
  private rerunTriggered = false

  private enabled = false

  constructor(extension: ExtensionWorker) {
    // eslint-disable-next-line ts/no-this-alias
    const state = this
    const ctx = extension.ctx
    ;(extension.getRootTestProject().provide as <T extends keyof ProvidedContext>(key: T, value: ProvidedContext[T]) => void)('__vscode', {
      get continuousFiles() {
        return state.files || []
      },
      get watchEveryFile() {
        return state.watchEveryFile ?? true
      },
      get rerunTriggered() {
        return state.rerunTriggered ?? false
      },
    })

    // @ts-expect-error modifying a private property
    const originalScheduleRerun = ctx.scheduleRerun.bind(ctx)
    // @ts-expect-error modifying a private property
    ctx.scheduleRerun = async function (files: string[]) {
      // if trigger is not a test file, remove all non-continious files from this.changedTests
      const triggerFile = files[0]
      const isTestFileTrigger = this.changedTests.has(triggerFile)

      // no continuous files for this Vitest instance, just collect tests
      if (!state.enabled) {
        // do not run any tests if continuous run was not enabled
        if (!isTestFileTrigger) {
          this.changedTests.clear()
          this.invalidates.clear()
          return await originalScheduleRerun.call(this, files)
        }

        const tests = Array.from(this.changedTests)
        const specs = tests.flatMap(file => this.getProjectsByTestFile(file))
        const astSpecs: [project: WorkspaceProject, file: string][] = []

        for (const [project, file] of specs) {
          if (extension.alwaysAstCollect || project.config.browser.enabled) {
            astSpecs.push([project, file])
          }
        }

        extension.setGlobalTestNamePattern(ExtensionWorker.COLLECT_NAME_PATTERN)
        ctx.logger.log('Collecting tests due to file changes:', ...files.map(f => relative(ctx.config.root, f)))

        if (astSpecs.length) {
          ctx.logger.log('Collecting using AST explorer...')
          await extension.astCollect(astSpecs)
          this.changedTests.clear()
          return await originalScheduleRerun.call(this, [])
        }

        return await originalScheduleRerun.call(this, files)
      }

      state.rerunTriggered = true

      const namePattern = state.testNamePattern ? new RegExp(state.testNamePattern) : undefined
      extension.setGlobalTestNamePattern(namePattern)
      if (state.watchEveryFile) {
        ctx.logger.log(
          'Rerunning all tests due to file changes:',
          ...files.map(f => relative(ctx.config.root, f)),
          namePattern ? `with pattern ${namePattern}` : '',
        )
        return await originalScheduleRerun.call(this, files)
      }

      if (!isTestFileTrigger) {
        // if souce code is changed and related tests are not continious, remove them from changedTests
        const currentChanged = Array.from(this.changedTests)
        this.changedTests.clear()
        for (const file of currentChanged) {
          if (state.isTestFileWatched(file))
            this.changedTests.add(file)
        }
      }

      if (this.changedTests.size) {
        ctx.logger.log(
          'Rerunning tests due to file changes:',
          ...[...this.changedTests].map(f => relative(ctx.config.root, f)),
          namePattern ? `with pattern ${namePattern}` : '',
        )
      }

      return await originalScheduleRerun.call(this, files)
    }
  }

  private isTestFileWatched(testFile: string) {
    if (!this.files?.length)
      return false

    return this.files.some((file) => {
      if (file === testFile)
        return true
      if (file[file.length - 1] === '/')
        return testFile.startsWith(file)
      return false
    })
  }

  markRerun(rerun: boolean) {
    this.rerunTriggered = rerun
  }

  trackTests(files: string[], testNamePatern: string | undefined) {
    this.enabled = true
    this.files = files
    this.watchEveryFile = false
    this.testNamePattern = testNamePatern
    this.rerunTriggered = false
  }

  trackEveryFile() {
    this.enabled = true
    this.watchEveryFile = true
    this.files = []
    this.testNamePattern = undefined
    this.rerunTriggered = false
  }

  stopTracking() {
    this.enabled = false
  }
}
