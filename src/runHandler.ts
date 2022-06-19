import { isAbsolute, relative } from 'path'
import { existsSync } from 'fs'
import * as vscode from 'vscode'
import type { File } from 'vitest'
import { readFile } from 'fs-extra'
import type { FormattedTestResults } from './pure/runner'
import {
  TestRunner,
  getNodeVersion,
  getTempPath,
} from './pure/runner'
import {
  filterColorFormatOutput,
  getVitestCommand,
  getVitestPath,
  sanitizeFilePath,
} from './pure/utils'
import {
  TestFile,
  WEAKMAP_TEST_DATA,
  getAllTestCases,
  getTestCaseId,
  testItemIdMap,
} from './TestData'
import { getConfig } from './config'
import { TestWatcher, syncFilesTestStatus } from './watch'
import { log } from './log'
import type { TestFileDiscoverer } from './discover'

export async function runHandler(
  ctrl: vscode.TestController,
  discover: TestFileDiscoverer,
  watchers: TestWatcher[],
  request: vscode.TestRunRequest,
  _cancellation: vscode.CancellationToken,
) {
  if (
    vscode.workspace.workspaceFolders === undefined
    || vscode.workspace.workspaceFolders.length === 0
  ) {
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

  await Promise.allSettled(vscode.workspace.workspaceFolders.map(async (folder) => {
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
      await runTest(ctrl, runner, run, testForThisWorkspace, 'run', discover)
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

  const request = new vscode.TestRunRequest([test])
  const tests = [test]
  const run = ctrl.createTestRun(request)
  run.started(test)
  await runTest(ctrl, runner, run, tests, 'update', discover)
  run.end()
}

export async function debugHandler(
  ctrl: vscode.TestController,
  discover: TestFileDiscoverer,
  request: vscode.TestRunRequest,
) {
  if (
    vscode.workspace.workspaceFolders === undefined
    || vscode.workspace.workspaceFolders.length === 0
  )
    return

  const run = ctrl.createTestRun(request)

  for (const folder of vscode.workspace.workspaceFolders) {
    const items = request.include ?? ctrl.items
    const testsInThisWorkspace = gatherTestItemsFromWorkspace(items, folder.uri.fsPath)
    if (testsInThisWorkspace.length === 0)
      continue
    try {
      await runTest(ctrl, undefined, run, testsInThisWorkspace, 'debug', discover)
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
    + 'Are there tests with the same name?\r\n'
    + 'Can you run vitest successfully on this file? Does it need custom option to run?'
async function runTest(
  ctrl: vscode.TestController,
  runner: TestRunner | undefined,
  run: vscode.TestRun,
  items: readonly vscode.TestItem[],
  mode: Mode,
  discover: TestFileDiscoverer,
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
    run.enqueued(testCase)
  })

  if (mode === 'run' || mode === 'update') {
    let command
    if (config.commandLine) {
      const commandLine = config.commandLine.trim()
      command = {
        cmd: commandLine.split(' ')[0],
        args: commandLine.split(' ').slice(1),
      }
    }

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
        syncFilesTestStatus(files, discover, ctrl, run, false, false)
      },
    )

    const finishedTests = syncFilesTestStatus(testResultFiles, discover, ctrl, run, true, false)
    for (const item of testCaseSet) {
      if (!finishedTests.has(item)) {
        run.errored(item, new vscode.TestMessage(`${TEST_NOT_FOUND_MESSAGE}\r\n\r\nVitest output:\r\n${filterColorFormatOutput(output)}`))
        log.error(`Test not found: ${item.id}`)
      }
    }
    return
  }

  testCaseSet.forEach((testCase) => {
    run.started(testCase)
  })

  const pathToFile = new Map<string, vscode.TestItem>()
  for (const file of fileItems)
    pathToFile.set(sanitizeFilePath(file.uri!.fsPath), file)

  let out

  try {
    out = await debugTest(workspaceFolder, run, items)
  }
  catch (e) {
    console.error(e)
    run.appendOutput(`Run test failed \r\n${e as Error}\r\n`)
    run.appendOutput(`${(e as Error)?.stack}\r\n`)
    testCaseSet.forEach((testCase) => {
      run.errored(testCase, new vscode.TestMessage((e as Error)?.toString()))
    })
    testCaseSet.clear()
  }

  if (out == null) {
    testCaseSet.forEach((testCase) => {
      run.errored(testCase, new vscode.TestMessage('Internal Error'))
    })
    return
  }

  if (out.testResults.length !== 0) {
    out.testResults.forEach(
      (fileResult) => {
        fileResult.assertionResults.forEach((result) => {
          const id = getTestCaseId(
            pathToFile.get(sanitizeFilePath(fileResult.name))!,
            result.fullName.trim(),
          ) || ''
          const child = testItemIdMap.get(id)!
          if (!child || !testCaseSet.has(child))
            return

          testCaseSet.delete(child)
          switch (result.status) {
            case 'passed':
              run.passed(child, result.duration ?? undefined)
              return
            case 'failed':
              run.failed(
                child,
                new vscode.TestMessage(result.failureMessages.join('\r\n')),
                result.duration ?? undefined,
              )
              return
          }

          if (result.status === 'skipped' || result.status == null)
            run.skipped(child)
        })
      },
    )

    testCaseSet.forEach((testCase) => {
      run.errored(
        testCase,
        new vscode.TestMessage(TEST_NOT_FOUND_MESSAGE),
      )
      run.appendOutput(`Cannot find test ${testCase.id}`)
    })
  }
  else {
    testCaseSet.forEach((testCase) => {
      run.errored(
        testCase,
        new vscode.TestMessage(
          'Unexpected condition. Please report the bug to https://github.com/vitest-dev/vscode/issues',
        ),
      )
    })
  }
}

async function debugTest(
  workspaceFolder: vscode.WorkspaceFolder,
  run: vscode.TestRun,
  testItems: readonly vscode.TestItem[],
) {
  const config = {
    type: 'pwa-node',
    request: 'launch',
    name: 'Debug Current Test File',
    autoAttachChildProcesses: true,
    skipFiles: ['<node_internals>/**', '**/node_modules/**'],
    program: getVitestPath(workspaceFolder.uri.fsPath),
    args: [] as string[],
    smartStep: true,
  }

  const outputFilePath = getTempPath()
  const testData = testItems.map(item => WEAKMAP_TEST_DATA.get(item)!)
  config.args = [
    'run',
    ...new Set(
      testData.map(x =>
        relative(workspaceFolder.uri.fsPath, x.getFilePath()).replace(
          /\\/g,
          '/',
        ),
      ),
    ),
    testData.length === 1 ? '--testNamePattern' : '',
    testData.length === 1 ? testData[0].getFullPattern() : '',
    '--reporter=default',
    '--reporter=json',
    '--outputFile',
    outputFilePath,
  ]

  if (config.program == null) {
    vscode.window.showErrorMessage('Cannot find vitest')
    return
  }

  return new Promise<FormattedTestResults>((resolve, reject) => {
    vscode.debug.startDebugging(workspaceFolder, config).then(
      () => {
        vscode.debug.onDidChangeActiveDebugSession((e) => {
          if (!e) {
            log.info('DISCONNECTED')
            setTimeout(async () => {
              if (!existsSync(outputFilePath)) {
                const prefix = 'When running:\r\n'
                  + `    node ${
                    `${config.program} ${config.args.join(' ')}`
                  }\r\n`
                  + `cwd: ${workspaceFolder.uri.fsPath}\r\n`
                  + `node: ${await getNodeVersion()}`
                  + `env.PATH: ${process.env.PATH}`
                reject(new Error(prefix))
                return
              }

              const file = await readFile(outputFilePath, 'utf-8')
              const out = JSON.parse(file) as FormattedTestResults
              resolve(out)
            })
          }
        })
      },
      (err) => {
        console.error(err)
        log.error('START DEBUGGING FAILED', err)
        reject(new Error('START DEBUGGING FAILED'))
      },
    )
  })
}
