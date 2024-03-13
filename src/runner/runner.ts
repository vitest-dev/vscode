import * as vscode from 'vscode'
import type { VitestAPI } from '../api'
import { TestFolder, getTestData } from '../testTreeData'
import { log } from '../log'
import type { DebugSessionAPI } from '../debug/startSession'
import { startDebugSession } from '../debug/startSession'
import type { TestTree } from '../testTree'
import { FolderTestRunner } from './folderRunner'

export class GlobalTestRunner extends vscode.Disposable {
  public testRunRequest?: vscode.TestRunRequest

  private runners: FolderTestRunner[] = []
  private debug?: DebugSessionAPI

  constructor(
    private readonly api: VitestAPI,
    private readonly tree: TestTree,
    private readonly controller: vscode.TestController,
  ) {
    super(() => {
      this.runners.forEach(runner => runner.dispose())
      this.runners = []
    })

    api.forEach((folderAPI) => {
      this.runners.push(new FolderTestRunner(this.controller, this, this.tree, folderAPI))
    })
  }

  public async debugTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    await this.debug?.stop()

    this.debug = await startDebugSession(
      this.api,
      this,
      request,
      token,
    )
  }

  public endTestRuns() {
    this.runners.forEach(runner => runner.endTestRun())
  }

  public async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    this.testRunRequest = request
    token.onCancellationRequested(() => {
      this.api.cancelRun()
      this.testRunRequest = undefined
      this.endTestRuns()
    })

    const tests = request.include ?? []

    if (!tests.length) {
      await this.api.runFiles()
    }
    else {
      const testNamePatern = formatTestPattern(tests)
      // run only affected folders
      const workspaces = new Map<vscode.WorkspaceFolder, vscode.TestItem[]>()
      tests.forEach((test) => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(test.uri!)
        if (!workspaceFolder) {
          log.error('Workspace folder not found for', test.uri?.fsPath)
          return
        }
        const folderTests = workspaces.get(workspaceFolder) ?? []
        folderTests.push(test)
        workspaces.set(workspaceFolder, folderTests)
      })
      for (const [folder, tests] of workspaces.entries()) {
        const folderAPI = this.api.get(folder)
        const files = getTestFiles(tests)
        await folderAPI.runFiles(files, testNamePatern)
      }
    }

    if (!request.continuous)
      this.testRunRequest = undefined
  }
}

function getTestFiles(tests: readonly vscode.TestItem[]) {
  return Array.from(
    new Set(tests.map((test) => {
      const data = getTestData(test)
      const fsPath = test.uri!.fsPath
      if (data instanceof TestFolder)
        return `${fsPath}/`
      return fsPath
    }).filter(Boolean) as string[]),
  )
}

function formatTestPattern(tests: readonly vscode.TestItem[]) {
  if (tests.length !== 1)
    return
  const data = getTestData(tests[0])!
  if (!('getTestNamePattern' in data))
    return
  return data.getTestNamePattern()
}
