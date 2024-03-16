import * as vscode from 'vscode'
import { basename, dirname, normalize } from 'pathe'
import type { File, Task } from 'vitest'
import type { TestData } from './testTreeData'
import { TestCase, TestFile, TestFolder, TestSuite, addTestData, getTestData } from './testTreeData'
import { log } from './log'
import type { VitestFolderAPI } from './api'

// testItem -> vscode.TestItem
// testData -> our wrapper
// task -> vitest.Task

export class TestTree extends vscode.Disposable {
  private flatTestItems = new Map<string, vscode.TestItem>()
  private fileItems: Map<string, vscode.TestItem> = new Map()
  private folderItems: Map<string, vscode.TestItem> = new Map()

  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()

  constructor(
    private readonly controller: vscode.TestController,
    private readonly loaderItem: vscode.TestItem,
  ) {
    super(() => {
      this.folderItems.clear()
      this.fileItems.clear()
      this.flatTestItems.clear()
      this.watcherByFolder.forEach(x => x.dispose())
      this.watcherByFolder.clear()
    })
  }

  public reset(workspaceFolders: vscode.WorkspaceFolder[]) {
    this.folderItems.clear()
    this.fileItems.clear()
    this.flatTestItems.clear()
    this.watcherByFolder.forEach(x => x.dispose())
    this.watcherByFolder.clear()

    this.loaderItem.busy = true

    if (workspaceFolders.length === 1) {
      const rootItem = this.getOrCreateInlineFolderItem(workspaceFolders[0].uri)
      rootItem.children.replace([this.loaderItem])
    }
    else {
      const folderItems = workspaceFolders.map(x => this.getOrCreateWorkspaceFolderItem(x.uri))
      this.controller.items.replace([this.loaderItem, ...folderItems])
    }
  }

  async discoverAllTestFiles(api: VitestFolderAPI, files: string[]) {
    for (const file of files)
      this.getOrCreateFileTestItem(api, file)

    return files
  }

  // in cases where there is only a single workspace, we don't show it as a folder
  // this inline folder is required for "createFolderItem" to properly resolve the parent,
  // otherwise it will go into an infinite loop
  getOrCreateInlineFolderItem(folderUri: vscode.Uri) {
    const id = normalize(folderUri.fsPath)
    const cached = this.folderItems.get(id)
    if (cached)
      return cached
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
    this.folderItems.set(id, item)
    return item
  }

  getOrCreateWorkspaceFolderItem(folderUri: vscode.Uri) {
    const cached = this.folderItems.get(normalize(folderUri.fsPath))
    if (cached)
      return cached

    const folderItem = this._createFolderItem(folderUri)
    this.folderItems.set(folderItem.id, folderItem)
    return folderItem
  }

  getOrCreateFileTestItem(api: VitestFolderAPI, file: string) {
    const fileId = normalize(file)
    const cached = this.fileItems.get(fileId)
    if (cached)
      return cached

    const fileUri = vscode.Uri.file(file)
    const parentItem = this.getOrCreateFolderTestItem(dirname(file))
    const testFileItem = this.controller.createTestItem(
      fileUri.toString(),
      basename(file),
      fileUri,
    )
    testFileItem.canResolveChildren = true
    parentItem.children.add(testFileItem)
    this.fileItems.set(fileId, testFileItem)
    addTestData(
      testFileItem,
      new TestFile(testFileItem, api),
    )

    return testFileItem
  }

  getOrCreateFolderTestItem(folder: string) {
    const cached = this.folderItems.get(folder)
    if (cached)
      return cached

    const folderUri = vscode.Uri.file(folder)
    const parentItem = this.getOrCreateFolderTestItem(dirname(folder))
    const folderItem = this._createFolderItem(folderUri)
    parentItem.children.add(folderItem)
    this.folderItems.set(folder, folderItem)
    return folderItem
  }

  private _createFolderItem(folderUri: vscode.Uri) {
    const folderFsPath = normalize(folderUri.fsPath)
    const folderItem = this.controller.createTestItem(
      folderFsPath,
      basename(folderFsPath),
      folderUri,
    )
    addTestData(folderItem, new TestFolder(folderItem))
    folderItem.canResolveChildren = false
    return folderItem
  }

  async watchTestFilesInWorkspace(api: VitestFolderAPI, testFiles: string[]) {
    await this.discoverAllTestFiles(api, testFiles)

    if (this.watcherByFolder.has(api.workspaceFolder))
      return

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(api.workspaceFolder, '**/*'),
    )
    this.watcherByFolder.set(api.workspaceFolder, watcher)

    watcher.onDidDelete((file) => {
      const item = this.fileItems.get(normalize(file.fsPath))
      if (item)
        this.recursiveDelete(this.controller.items, item)
    })
  }

  private recursiveDelete(collection: vscode.TestItemCollection, item: vscode.TestItem) {
    collection.delete(item.id)
    this.flatTestItems.delete(item.id)
    if (item.parent) {
      item.parent.children.delete(item.id)
      if (item.parent.children.size === 0)
        this.recursiveDelete(collection, item.parent)
    }
  }

  async discoverFileTests(testItem: vscode.TestItem) {
    const api = getAPIFromTestItem(testItem)
    if (!api) {
      log.error(`Cannot find collector for ${testItem.uri?.fsPath}`)
      return null
    }
    testItem.busy = true
    try {
      await api.collectTests(testItem.uri!.fsPath)
      return testItem
    }
    finally {
      testItem.busy = false
    }
  }

  removeFileTag(file: string, tag: vscode.TestTag) {
    const testItem = this.fileItems.get(normalize(file))
    if (!testItem)
      return
    testItem.tags = testItem.tags.filter(x => x !== tag)
  }

  public getTestDataByTaskId(taskId: string): TestData | null {
    const testItem = this.flatTestItems.get(taskId)
    if (!testItem)
      return null
    return getTestData(testItem) || null
  }

  public getTestDataByTask(task: Task): TestData | null {
    const cachedItem = this.flatTestItems.get(task.id)
    if (cachedItem)
      return getTestData(cachedItem) || null
    if ('filepath' in task && task.filepath) {
      const testItem = this.fileItems.get(task.filepath)
      return testItem ? getTestData(testItem) || null : null
    }
    return null
  }

  collectFile(api: VitestFolderAPI, file: File) {
    const fileTestItem = this.getOrCreateFileTestItem(api, file.filepath)
    this.flatTestItems.set(file.id, fileTestItem)
    this.collectTasks(file.tasks, fileTestItem)
    if (file.result?.errors) {
      const error = file.result.errors.map(error => error.stack).join('\n')
      fileTestItem.error = error
    }
    fileTestItem.canResolveChildren = false
  }

  collectTasks(tasks: Task[], item: vscode.TestItem) {
    for (const task of tasks) {
      const testItem = this.flatTestItems.get(task.id) || this.controller.createTestItem(
        task.id,
        task.name,
        item.uri,
      )
      testItem.sortText = task.id
      testItem.label = task.name
      const location = task.location
      if (location) {
        const position = new vscode.Position(location.line - 1, location.column)
        testItem.range = new vscode.Range(position, position)
      }
      this.flatTestItems.set(task.id, testItem)
      item.children.add(testItem)
      if (task.type === 'suite')
        addTestData(testItem, new TestSuite(testItem))
      else if (task.type === 'test' || task.type === 'custom')
        addTestData(testItem, new TestCase(testItem))

      if ('tasks' in task)
        this.collectTasks(task.tasks, testItem)
    }

    // remove tasks that are no longer present
    const ids = new Set(tasks.map(x => x.id))
    item.children.forEach((child) => {
      if (!ids.has(child.id))
        item.children.delete(child.id)
    })
  }
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
  let iter: vscode.TestItem | undefined = testItem
  // API is stored in test files - if this is a folder, try to find a file inside,
  // otherwise go up until we find a file
  if (getTestData(iter) instanceof TestFolder) {
    return getAPIFromFolder(iter)
  }
  else {
    while (iter) {
      const data = getTestData(iter)
      if (data instanceof TestFile)
        return data.api
      iter = iter.parent
    }
  }
  return null
}
