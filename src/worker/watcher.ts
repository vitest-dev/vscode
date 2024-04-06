import type { ProvidedContext, Vitest as VitestCore } from 'vitest'

export class VitestWatcher {
  private files: string[] = []
  private testNamePattern: string | undefined
  private watchEveryFile = false
  private rerunTriggered = false

  private enabled = false

  constructor(vitest: VitestCore) {
    // eslint-disable-next-line ts/no-this-alias
    const state = this
    vitest.getCoreWorkspaceProject().provide('__vscode', {
      get continuousFiles() {
        return state.files || []
      },
      get watchEveryFile() {
        return state.watchEveryFile ?? true
      },
      get rerunTriggered() {
        return state.rerunTriggered ?? false
      },
    } satisfies ProvidedContext['__vscode'])

    // @ts-expect-error modifying a private property
    const originalScheduleRerun = vitest.scheduleRerun.bind(vitest)
    // @ts-expect-error modifying a private property
    vitest.scheduleRerun = async function (files: string[]) {
      // if trigger is not a test file, remove all non-continious files from  this.changedTests
      const triggerFile = files[0]
      const isTestFileTrigger = this.changedTests.has(triggerFile)

      // no continuous files for this Vitest instance, just collect tests
      if (!state.enabled) {
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
