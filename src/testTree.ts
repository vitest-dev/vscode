import { lstatSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import * as vscode from 'vscode'
import { basename, dirname, normalize } from 'pathe'
import type { RunnerTask, RunnerTestFile } from 'vitest'
import { TestCase, TestFile, TestFolder, TestSuite, getTestData } from './testTreeData'
import { log } from './log'
import type { VitestFolderAPI } from './api'
import { ExtensionWatcher } from './watcher'

// testItem -> vscode.TestItem
// testData -> our wrapper
// task -> vitest.Task

export class TestTree extends vscode.Disposable {
  private flatTestItems = new Map<string, vscode.TestItem>()
  private fileItems: Map<string, vscode.TestItem> = new Map()
  private folderItems: Map<string, vscode.TestItem> = new Map()

  // it's possible to have several test items for the same file
  // file test items have the project name in their id, so we need a separate map
  // to store all of them
  private testItemsByFile = new Map<string, vscode.TestItem[]>()
  private testFiles = new Set<string>()

  private watcher: ExtensionWatcher

  constructor(
    private readonly controller: vscode.TestController,
    private readonly loaderItem: vscode.TestItem,
  ) {
    super(() => {
      this.folderItems.clear()
      this.fileItems.clear()
      this.flatTestItems.clear()
      this.testItemsByFile.clear()
      this.watcher.dispose()
    })
    this.watcher = new ExtensionWatcher(this)
  }

  public getFileTestItems(fsPath: string) {
    return this.testItemsByFile.get(normalize(fsPath)) || []
  }

  public getAllFileItems() {
    return Array.from(this.fileItems.values())
  }

  public reset(workspaceFolders: vscode.WorkspaceFolder[]) {
    this.folderItems.clear()
    this.testItemsByFile.clear()
    this.fileItems.clear()
    this.flatTestItems.clear()
    this.watcher.reset()

    this.loaderItem.busy = true

    if (workspaceFolders.length === 1) {
      const rootItem = this.getOrCreateInlineFolderItem(workspaceFolders[0].uri)
      rootItem.children.replace([this.loaderItem])
    }
    else {
      const folderItems = workspaceFolders.map((x) => {
        const item = this.getOrCreateWorkspaceFolderItem(x.uri)
        item.children.replace([])
        item.busy = true
        return item
      })
      this.controller.items.replace(folderItems)
    }
  }

  async discoverAllTestFiles(api: VitestFolderAPI, files: [project: string, file: string][]) {
    const folderItem = this.folderItems.get(normalize(api.workspaceFolder.uri.fsPath))
    if (folderItem)
      folderItem.busy = false

    for (const [project, file] of files)
      this.getOrCreateFileTestItem(api, project, file)

    return files
  }

  // in cases where there is only a single workspace, we don't show it as a folder
  // this inline folder is required for "createFolderItem" to properly resolve the parent,
  // otherwise it will go into an infinite loop
  getOrCreateInlineFolderItem(folderUri: vscode.Uri) {
    let id = normalize(folderUri.fsPath)
    const cached = this.folderItems.get(id)
    if (cached)
      return cached
    const stats = lstatSync(folderUri.fsPath)
    if (stats.isSymbolicLink()) {
      const actualPath = readlinkSync(folderUri.fsPath)
      const dir = dirname(folderUri.fsPath)
      id = resolve(dir, actualPath)
      folderUri = vscode.Uri.file(id)
    }
    const cachedSymlink = this.folderItems.get(id)
    if (cachedSymlink)
      return cachedSymlink
    const item: vscode.TestItem = {
      id: folderUri.toString(),
      children: this.controller.items,
      uri: folderUri,
      label: '<root>',
      canResolveChildren: false,
      busy: false,
      parent: undefined,
      tags: [],
      range: undefined,
      error: undefined,
    }
    TestFolder.register(item)
    this.folderItems.set(id, item)
    return item
  }

  getOrCreateWorkspaceFolderItem(folderUri: vscode.Uri) {
    const folderId = normalize(folderUri.fsPath)
    const cached = this.folderItems.get(folderId)
    if (cached)
      return cached

    const folderItem = this._createFolderItem(folderUri)
    this.folderItems.set(folderId, folderItem)
    return folderItem
  }

  getOrCreateFileTestItem(api: VitestFolderAPI, project: string, file: string) {
    const normalizedFile = normalize(file)
    const fileId = `${normalizedFile}${project}`
    const cached = this.fileItems.get(fileId)
    if (cached)
      return cached

    const fileUri = vscode.Uri.file(resolve(file))
    const parentItem = this.getOrCreateFolderTestItem(api, dirname(file))
    const label = `${basename(file)}${project ? ` [${project}]` : ''}`
    const testFileItem = this.controller.createTestItem(
      fileId,
      label,
      fileUri,
    )
    // "description" looks nicer in the test explorer,
    // but it's not displayed in the gutter icon
    // testFileItem.description = project
    testFileItem.tags = [api.tag]
    testFileItem.canResolveChildren = true
    TestFile.register(
      testFileItem,
      parentItem,
      normalizedFile,
      api,
      project,
    )
    parentItem.children.add(testFileItem)
    this.fileItems.set(fileId, testFileItem)
    const cachedItems = this.testItemsByFile.get(normalizedFile) || []
    cachedItems.push(testFileItem)
    this.testItemsByFile.set(normalizedFile, cachedItems)
    this.testFiles.add(fileUri.fsPath)
    vscode.commands.executeCommand(
      'setContext',
      'vitest.testFiles',
      Array.from(this.testFiles),
    )

    return testFileItem
  }

  getOrCreateFolderTestItem(api: VitestFolderAPI, normalizedFolder: string) {
    const cached = this.folderItems.get(normalizedFolder)
    if (cached) {
      if (!cached.tags.includes(api.tag))
        cached.tags = [...cached.tags, api.tag]
      return cached
    }

    const folderUri = vscode.Uri.file(normalizedFolder)
    const parentItem = this.getOrCreateFolderTestItem(api, dirname(normalizedFolder))
    const folderItem = this._createFolderItem(folderUri, parentItem)
    folderItem.tags = [api.tag]
    parentItem.children.add(folderItem)
    this.folderItems.set(normalizedFolder, folderItem)
    return folderItem
  }

  private _createFolderItem(folderUri: vscode.Uri, parentItem?: vscode.TestItem) {
    const folderFsPath = normalize(folderUri.fsPath)
    const folderItem = this.controller.createTestItem(
      folderFsPath,
      basename(folderFsPath),
      folderUri,
    )
    TestFolder.register(folderItem, parentItem)
    folderItem.canResolveChildren = false
    return folderItem
  }

  async watchTestFilesInWorkspace(api: VitestFolderAPI, testFiles: [prject: string, file: string][]) {
    await this.discoverAllTestFiles(api, testFiles)
    this.watcher.watchTestFilesInWorkspace(api)
  }

  public removeFile(filepath: string) {
    const items = this.testItemsByFile.get(normalize(filepath))
    items?.forEach(item => this.recursiveDelete(item))
  }

  private recursiveDelete(item: vscode.TestItem) {
    if (!item.parent)
      return
    item.parent.children.delete(item.id)
    this.flatTestItems.delete(item.id)
    const data = getTestData(item)

    if (data instanceof TestFile) {
      this.testItemsByFile.delete(data.filepath)
      this.fileItems.delete(item.id)
    }
    if (data instanceof TestFolder)
      this.folderItems.delete(item.id)

    if (!item.parent.children.size)
      this.recursiveDelete(item.parent)
  }

  public getAPIFromTestItem(testItem: vscode.TestItem) {
    return getAPIFromTestItem(testItem)
  }

  async discoverFileTests(testItem: vscode.TestItem) {
    const data = getTestData(testItem)
    if (!(data instanceof TestFile))
      return
    const api = data.api
    if (!api) {
      log.error(`Cannot find collector for ${testItem.uri?.fsPath}`)
      return null
    }
    testItem.busy = true
    try {
      await api.collectTests(data.project, testItem.uri!.fsPath)
      return testItem
    }
    finally {
      testItem.busy = false
    }
  }

  public getTestItemByTaskId(taskId: string): vscode.TestItem | undefined {
    const testItem = this.flatTestItems.get(taskId)
    if (!testItem)
      return undefined
    return testItem || undefined
  }

  public getTestItemByTask(task: RunnerTask): vscode.TestItem | null {
    const cachedItem = this.flatTestItems.get(task.id)
    if (cachedItem)
      return cachedItem
    if ('filepath' in task && task.filepath) {
      const testItem = this.fileItems.get(`${task.filepath}${task.projectName || ''}`)
      return testItem || null
    }
    return null
  }

  public getFolderFiles(folder: vscode.TestItem): vscode.TestItem[] {
    const files: vscode.TestItem[] = []
    for (const [_, item] of folder.children) {
      const data = getTestData(item)
      if (data instanceof TestFile)
        files.push(item)
      else if (data instanceof TestFolder)
        files.push(...this.getFolderFiles(item))
    }
    return files
  }

  collectFile(api: VitestFolderAPI, file: RunnerTestFile) {
    const fileTestItem = this.getOrCreateFileTestItem(api, file.projectName || '', file.filepath)
    fileTestItem.error = undefined
    this.flatTestItems.set(file.id, fileTestItem)
    const data = getTestData(fileTestItem) as TestFile
    this.collectTasks(api.tag, data, file.tasks, fileTestItem)
    if (file.result?.errors) {
      const error = file.result.errors.map(error => error.stack || error.message).join('\n')
      fileTestItem.error = error
      log.error(`Error in ${file.filepath}`, error)
    }
    else if (!file.tasks.length) {
      fileTestItem.error = `No tests found in ${file.filepath}`
    }
    fileTestItem.canResolveChildren = false
  }

  private cacheDynamic: {
    [file: string]: {
      [dynamicTitle: string]: {
        id: string
        type: 'test' | 'suite'
        children: Set<string>
      }
    }
  } = {}

  collectTasks(tag: vscode.TestTag, fileData: TestFile, tasks: RunnerTask[], parent: vscode.TestItem) {
    const fileCachedTests = this.cacheDynamic[fileData.filepath] || (this.cacheDynamic[fileData.filepath] = {})
    const ids = new Set()

    for (const task of tasks) {
      ids.add(task.id)
      const cachedItem = this.flatTestItems.get(task.id)
      // suite became a test or vice versa
      if (cachedItem) {
        const data = getTestData(cachedItem)
        const taskType = isTest(task) ? 'test' : task.type
        if (data.type !== taskType) {
          parent.children.delete(cachedItem.id)
          this.flatTestItems.delete(task.id)
        }
      }

      const testItem = this.flatTestItems.get(task.id) || this.controller.createTestItem(
        task.id,
        task.name,
        parent.uri,
      )
      testItem.tags = Array.from(new Set([...parent.tags, tag]))
      testItem.error = undefined
      testItem.label = task.name
      const location = task.location
      if (location) {
        const position = new vscode.Position(location.line - 1, location.column)
        testItem.range = new vscode.Range(position, position)
      }
      else {
        log.error(`Cannot find location for "${testItem.label}". Using "id" to sort instead.`)
        testItem.sortText = task.id
      }
      // dynamic exists only during AST collection
      // see src/worker/collect.ts:172
      const isDynamic = (task as any).dynamic
      if (task.type === 'suite')
        TestSuite.register(testItem, parent, fileData, isDynamic)
      else if (isTest(task))
        TestCase.register(testItem, parent, fileData, isDynamic)

      if (isDynamic) {
        testItem.description = 'pattern'
        const dynamicTestRegExp = (getTestData(testItem) as TestCase | TestSuite).getTestNamePattern()

        const cachedDynamicTest = fileCachedTests[dynamicTestRegExp] || (fileCachedTests[dynamicTestRegExp] = {
          id: task.id,
          type: isTest(task) ? 'test' : task.type,
          children: new Set(),
        })
        cachedDynamicTest.children.forEach((fileId) => {
          // don't remove tests that were collected during runtime
          ids.add(fileId)
        })
      }
      else if (task.each) {
        const fullName = getTaskFullName(task)
        // order in the opposite order so we only match one item with the longest name
        const orderedTests = Object.entries(fileCachedTests).sort(([a1], [a2]) => a2.localeCompare(a1))
        for (const [testRegexp, cachedDynamicTask] of orderedTests) {
          if (new RegExp(testRegexp).test(fullName)) {
            const testId = cachedDynamicTask.id
            const childId = `${testId}_${task.suite?.id || 'none'}`

            // keep the dynamic pattern to display it alongside normal tests,
            // if the parent suite was also dynamic, this item will be duplicated
            // in every suite, but scoped only to that suite
            const dynamicTestItem = this.flatTestItems.get(testId)
            ids.add(childId)
            if (dynamicTestItem) {
              // we are creating a separate one because we can't use the same one in multiple places
              const suiteCopyChild = this.flatTestItems.get(childId) || this.controller.createTestItem(
                childId,
                dynamicTestItem.label,
                dynamicTestItem.uri,
              )
              this.flatTestItems.set(childId, suiteCopyChild)
              suiteCopyChild.tags = dynamicTestItem.tags
              suiteCopyChild.canResolveChildren = dynamicTestItem.canResolveChildren
              suiteCopyChild.description = dynamicTestItem.description
              suiteCopyChild.range = dynamicTestItem.range
              suiteCopyChild.error = dynamicTestItem.error
              suiteCopyChild.sortText = dynamicTestItem.sortText

              if (task.type === 'suite') {
                TestSuite.register(suiteCopyChild, parent, fileData, true)
              }
              else {
                TestCase.register(suiteCopyChild, parent, fileData, true)
              }

              parent.children.add(suiteCopyChild)
              break
            }
            cachedDynamicTask.children.add(task.id)
          }
        }
      }

      this.flatTestItems.set(task.id, testItem)
      parent.children.add(testItem)

      // errors during collection are not test failures, they need to be
      // displayed as errors in the tree
      if (task.result?.errors) {
        const error = task.result.errors.map(error => error.stack).join('\n')
        testItem.error = error
      }

      if ('tasks' in task)
        this.collectTasks(tag, fileData, task.tasks, testItem)
    }

    // remove tasks that are no longer present
    parent.children.forEach((child) => {
      if (!ids.has(child.id))
        parent.children.delete(child.id)
    })
  }
}

function isTest(task: RunnerTask) {
  if (task.type === 'suite') {
    return false
  }
  return true
}

function getAPIFromFolder(folder: vscode.TestItem): VitestFolderAPI | null {
  const data = getTestData(folder)
  if (data instanceof TestFile)
    return data.api
  if (!(data instanceof TestFolder))
    return null
  for (const [, child] of folder.children) {
    const api = getAPIFromTestItem(child)
    if (api)
      return api
  }
  return null
}

function getAPIFromTestItem(testItem: vscode.TestItem): VitestFolderAPI | null {
  const data = getTestData(testItem)
  // API is stored in test files - if this is a folder, try to find a file inside,
  // otherwise go up until we find a file, this should never be a folder
  if (data instanceof TestFolder)
    return getAPIFromFolder(testItem)

  if (data instanceof TestFile)
    return data.api
  return data.file.api
}

function getTaskFullName(task: RunnerTask): string {
  return `${task.suite ? `${getTaskFullName(task.suite)} ` : ''}${task.name}`
}
