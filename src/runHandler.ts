import { isAbsolute, relative } from 'path'
import * as vscode from 'vscode'
import type { File } from 'vitest'
import {
  TestRunner,
} from './pure/runner'
import {
  filterColorFormatOutput,
  getVitestCommand,
  getVitestPath,
} from './pure/utils'
import {
  TestFile,
  WEAKMAP_TEST_DATA,
  getAllTestCases,
  testItemIdMap,
} from './TestData'
import { getConfig } from './config'
import { TestWatcher, syncFilesTestStatus } from './watch'
import { log } from './log'
import type { TestFileDiscoverer } from './discover'
import type { StartConfig } from './pure/ApiProcess'

export async function runHandler(
  ctrl: vscode.TestController,
  discover: TestFileDiscoverer,
  watchers: TestWatcher[],
  workspaces: vscode.WorkspaceFolder[],
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
) {
  if (workspaces.length === 0) {
    log.info('ERROR: No workspace folder found')
    vscode.window.showErrorMessage('Cannot run tests: No workspace folder found')
    return
  }

  if (watchers.some(watcher => TestWatcher.isWatching(watcher.id)) && watchers.length > 0) {
    log.info('Use watchers to run tests')
    watchers.forEach((watcher) => {
      watcher.runTests(gatherTestItemsFromWorkspace(request.include ?? [], watcher.workspace.uri.fsPath))
    })
    return
  }

  log.info('Tests run start')
  const run = ctrl.createTestRun(request)

  await Promise.allSettled(workspaces.map(async (folder) => {
    const runner = new TestRunner(
      folder.uri.fsPath,
      getVitestCommand(folder.uri.fsPath),
    )

    const items = request.include ?? ctrl.items

    const testForThisWorkspace = gatherTestItemsFromWorkspace(items, folder.uri.fsPath)
    if (testForThisWorkspace.length === 0)
      return

    log.info(`[Workspace "${folder.name}] Run tests from workspace`)
    try {
      await runTest(ctrl, runner, run, testForThisWorkspace, 'run', discover, cancellation)
      log.info(`[Workspace "${folder.name}] Test run finished`)
    }
    catch (e) {
      log.error(`[Workspace "${folder.name}] Run error`)
      if (e instanceof Error) {
        const err = e
        console.error(e)
        log.info(`[Workspace ${folder.name}] Error: ${e.toString()}`)
        testForThisWorkspace.forEach(test => run.errored(test, new vscode.TestMessage(err.toString())))
      }
    }
  }))

  run.end()
  log.info('Tests run end')
}

export async function updateSnapshot(
  ctrl: vscode.TestController,
  discover: TestFileDiscoverer,
  test: vscode.TestItem,
) {
  if (
    vscode.workspace.workspaceFolders === undefined
    || vscode.workspace.workspaceFolders.length === 0
  )
    return

  test = testItemIdMap.get(ctrl)!.get(test.id)!

  const workspace = determineWorkspaceForTestItems([test], vscode.workspace.workspaceFolders)
  const runner = new TestRunner(workspace.uri.fsPath, getVitestCommand(workspace.uri.fsPath))

  const request = new vscode.TestRunRequest([test], undefined, undefined, true)
  const tests = [test]
  const run = ctrl.createTestRun(request)
  run.started(test)
  await runTest(ctrl, runner, run, tests, 'update', discover)
  run.end()
}

export async function debugHandler(
  ctrl: vscode.TestController,
  discover: TestFileDiscoverer,
  workspaces: vscode.WorkspaceFolder[],
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
) {
  if (workspaces.length === 0)
    return

  const run = ctrl.createTestRun(request)

  for (const folder of workspaces) {
    const items = request.include ?? ctrl.items
    const testsInThisWorkspace = gatherTestItemsFromWorkspace(items, folder.uri.fsPath)
    if (testsInThisWorkspace.length === 0)
      continue
    try {
      const runner = new TestRunner(folder.uri.fsPath, getVitestCommand(folder.uri.fsPath))
      await runTest(ctrl, runner, run, testsInThisWorkspace, 'debug', discover, cancellation)
    }
    catch (e) {
      if (e instanceof Error) {
        const err = e
        console.error(e)
        log.info(`Error in ${folder.name}: ${e.toString()}`)
        testsInThisWorkspace.forEach(test => run.errored(test, new vscode.TestMessage(err.toString())))
      }
    }
  }

  run.end()
}

function gatherTestItems(collection: readonly vscode.TestItem[] | vscode.TestItemCollection): vscode.TestItem[] {
  if (Array.isArray(collection))
    return collection

  const items: vscode.TestItem[] = []
  collection.forEach(item => items.push(item))
  return items
}

function isPathASubdirectory(parent: string, testPath: string): boolean {
  const relativePath = relative(parent, testPath)
  return (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export function gatherTestItemsFromWorkspace(collection: readonly vscode.TestItem[] | vscode.TestItemCollection, workspace: string) {
  return gatherTestItems(collection).filter((item: vscode.TestItem) => item.uri && isPathASubdirectory(workspace, item.uri.fsPath))
}

function determineWorkspaceForTestItems(collection: readonly vscode.TestItem[] | vscode.TestItemCollection, workspaces: readonly vscode.WorkspaceFolder[]): vscode.WorkspaceFolder {
  if (workspaces.length === 1)
    return workspaces[0]

  const testItems = gatherTestItems(collection)

  if (testItems.length < 1)
    return workspaces[0]

  const workspace = workspaces.find(workspace => testItems[0].uri && isPathASubdirectory(workspace.uri.fsPath, testItems[0].uri.fsPath))

  if (!workspace)
    throw new Error('Multiple workspace roots are found; cannot deduce workspace to which these tests belong to')

  return workspace
}

type Mode = 'debug' | 'run' | 'update'
const TEST_NOT_FOUND_MESSAGE
= 'Test result not found. \r\n'
    + 'If you set `vitest.commandLine` please check: \r\n'
    + '    Did you set `vitest.commandLine` to `run` mode? (This extension requires `watch` mode to get the results from Vitest api)\r\n'
    + '    Does it have the ability to append extra arguments? (For example it should be `yarn test --` rather than `yarn test`)\r\n'
    + 'Are there tests with the same name?\r\n'
    + 'Can you run vitest successfully on this file? Does it need custom option to run?\r\n'
async function runTest(
  ctrl: vscode.TestController,
  runner: TestRunner | undefined,
  run: vscode.TestRun,
  items: readonly vscode.TestItem[],
  mode: Mode,
  discover: TestFileDiscoverer,
  cancellation?: vscode.CancellationToken,
) {
  if (mode !== 'debug' && runner === undefined)
    throw new Error('should provide runner if not debug')

  const workspaceFolder = determineWorkspaceForTestItems(items, vscode.workspace.workspaceFolders!)
  const config = getConfig(workspaceFolder)
  const testCaseSet: Set<vscode.TestItem> = new Set()
  const testItemIdMap = new Map<string, vscode.TestItem>()
  const fileItems: vscode.TestItem[] = []
  for (const item of items) {
    const testingData = WEAKMAP_TEST_DATA.get(item)
    if (!testingData) {
      log.workspaceError(workspaceFolder.name, `Item not found ${item.uri?.fsPath}`)
      run.errored(item, new vscode.TestMessage('Item not found'))
      continue
    }

    if (testingData instanceof TestFile)
      await testingData.load(ctrl)

    let file: vscode.TestItem
    if (testingData instanceof TestFile) {
      file = item
    }
    else {
      file = testingData.fileItem
      if (!file) {
        log.workspaceError(workspaceFolder.name, `File item not found for item ${item.uri?.fsPath}`)
        run.errored(item, new vscode.TestMessage('Item not found'))
        continue
      }
    }

    fileItems.push(file)
    const fileTestCases = getAllTestCases(file)
    for (const testCase of fileTestCases) {
      // remove suffix of test item id
      // e.g. "test-case@1" -> "test-case"
      // TODO: refactor
      testItemIdMap.set(testCase.id.replace(/@\d+$/g, ''), testCase)
    }

    for (const test of getAllTestCases(item))
      testCaseSet.add(test)
  }

  testCaseSet.forEach((testCase) => {
    run.started(testCase)
  })

  let command
  if (config.commandLine) {
    const commandLine = config.commandLine.trim()
    command = {
      cmd: commandLine.split(' ')[0],
      args: commandLine.split(' ').slice(1),
    }
  }

  const startDebugProcess
    = async ({ args, cfg, log, onProcessEnd: onFinished, registerOnTestFinished }: StartConfig) => {
      let thisSession: vscode.DebugSession | undefined
      const dispose1 = vscode.debug.onDidStartDebugSession((session) => {
        thisSession = session
        dispose1.dispose()
      })
      const dispose2 = vscode.debug.onDidTerminateDebugSession((session) => {
        if (thisSession !== session)
          return

        let timeout = false
        let restarted = false
        const newDispose = vscode.debug.onDidStartDebugSession((session) => {
          newDispose.dispose()
          if (timeout)
            return

          restarted = true
          thisSession = session
        })

        setTimeout(() => {
          if (!restarted) {
            timeout = true
            onFinished()
            dispose2.dispose()
            newDispose.dispose()
          }
        }, 200)
      })
      registerOnTestFinished(() => {
        vscode.debug.stopDebugging(thisSession)
      })
      vscode.debug.startDebugging(workspaceFolder, {
        type: 'pwa-node',
        request: 'launch',
        name: 'Debug Current Test File',
        autoAttachChildProcesses: true,
        skipFiles: config.debugExclude,
        program: getVitestPath(workspaceFolder.uri.fsPath),
        args,
        smartStep: true,
        env: cfg.env,
      }).then(() => {
        log('Debugging started')
      }, (err) => {
        log('Start debugging failed')
        log(err.toString())
        dispose1.dispose()
        dispose2.dispose()
      })
    }
  const finishedTests: Set<vscode.TestItem> = new Set()
  const { output, testResultFiles } = await runner!.scheduleRun(
    fileItems.map(x => x.uri!.fsPath),
    items.length === 1
      ? WEAKMAP_TEST_DATA.get(items[0])!.getFullPattern()
      : '',
    {
      info: (msg: string) => {
        if (items.length === 1)
          run.appendOutput(msg, undefined, items[0])
        else
          run.appendOutput(msg)
      },
      error: log.error,
    },
    config.env || undefined,
    command,
    mode === 'update',
    (files: File[]) => {
      syncFilesTestStatus(files, discover, ctrl, run, false, false, finishedTests)
    },
    mode === 'debug' ? startDebugProcess : undefined,
    cancellation,
  )

  syncFilesTestStatus(testResultFiles, discover, ctrl, run, true, false, finishedTests)
  if (mode !== 'debug' && !cancellation?.isCancellationRequested) {
    for (const item of testCaseSet) {
      let testFinished = false
      for (const finishedItem of finishedTests) {
        if (finishedItem.id === item.id)
          testFinished = true
      }
      if (!testFinished) {
        run.errored(item, new vscode.TestMessage(`${TEST_NOT_FOUND_MESSAGE}\r\n\r\nVitest output:\r\n${filterColorFormatOutput(output)}`))
        log.error(`Test not found: ${item.id}`)
      }
    }
  }
}

