import type * as vscode from 'vscode'
import type { VitestPackage } from './api/pkg'
import type { DebugManager } from './debug'
import type { ExtensionDiagnostic } from './diagnostic'
import type { TestTree } from './testTree'
import { createVitestProcess } from './api/child_process'
import { createVitestTerminalProcess } from './api/terminal'
import { getConfig } from './config'

export async function debugBrowserTests(
  controller: vscode.TestController,
  tree: TestTree,
  pkg: VitestPackage,
  diagnostic: ExtensionDiagnostic | undefined,

  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
  debugManager: DebugManager,
) {
  const config = getConfig(pkg.folder)
  if (config.cliArguments && !pkg.arguments) {
    pkg.arguments = `vitest ${config.cliArguments}`
  }

  const vitest = config.shellType === 'terminal'
    ? await createVitestTerminalProcess(pkg)
    : await createVitestProcess(pkg)
  if (token.isCancellationRequested) {
    return
  }
  console.log('todo')
}
