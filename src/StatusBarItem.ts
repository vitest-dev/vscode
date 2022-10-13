import * as vscode from 'vscode'
import { Command } from './command'
import { getRootConfig } from './config'

export class StatusBarItem extends vscode.Disposable {
  public item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    5,
  )

  constructor() {
    super(() => {
      this.item.dispose()
    })

    this.toDefaultMode()
  }

  toDefaultMode() {
    this.item.command = Command.StartWatching
    this.item.text = '$(test-view-icon) Vitest'
    this.item.tooltip = 'Click to start watch mode'
    this.setBackgroundColor(false)
    this.item.show()
  }

  hide() {
    this.item.hide()
  }

  toWatchMode(
    { passed, failed, skipped }: {
      passed: number
      failed: number
      skipped: number
    },
  ) {
    this.item.command = Command.StopWatching
    const total = passed + failed
    this.item.text = `$(eye-watch) ${passed}/${total} passed (${
      (passed / total * 100).toFixed(0)
    }%, ${skipped} skipped)`
    this.item.tooltip = 'Vitest is watching. Click to stop.'
    this.setBackgroundColor(failed > 0)
    this.item.show()
  }

  toRunningMode() {
    this.item.command = Command.StopWatching
    this.item.text = '$(loading~spin) Vitest is running'
    this.item.tooltip = 'Click to stop watching'
    this.setBackgroundColor(false)
    this.item.show()
  }

  setBackgroundColor(failedTests: Boolean) {
    if (getRootConfig().changeBackgroundColor)
      this.item.backgroundColor = failedTests ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
  }
}
