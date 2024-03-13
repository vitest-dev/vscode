import * as vscode from 'vscode'
import { basename, dirname, normalize } from 'pathe'
import type { File, Task } from 'vitest'
import type { VitestAPI } from './api'
import type { TestData } from './testTreeData'
import { TestCase, TestFile, TestFolder, TestSuite, addTestData, getTestData } from './testTreeData'
import { log } from './log'

// testItem -> vscode.TestItem
// testData -> our wrapper
// task -> vitest.Task

export class TestTree extends vscode.Disposable {
  private watchers: vscode.FileSystemWatcher[] = []

  private flatTestItems = new Map<string, vscode.TestItem>()
  private fileItems: Map<string, vscode.TestItem> = new Map()

  private folderItems: Map<string, vscode.TestItem> = new Map()

  constructor(
    private readonly api: VitestAPI,
    private readonly controller: vscode.TestController,
    private readonly workspaceFolders: readonly vscode.WorkspaceFolder[],
    private readonly loaderItem: vscode.TestItem,
  ) {
    super(() => {
      this.folderItems.clear()
      this.fileItems.clear()
      this.flatTestItems.clear()
      this.watchers.forEach(x => x.dispose())
      this.watchers = []
    })
  }

  async discoverAllTestFiles() {
    this.folderItems.clear()
    this.fileItems.clear()
    this.flatTestItems.clear()

    if (this.workspaceFolders.length === 1) {
      const rootItem = this.getOrCreateInlineFolderItem(this.workspaceFolders[0].uri)
      rootItem.children.replace([this.loaderItem])
    }
    else {
      const folderItems = this.workspaceFolders.map(x => this.getOrCreateWorkspaceFolderItem(x.uri))
      this.controller.items.replace([this.loaderItem, ...folderItems])
    }

    const testFiles = await this.api.getFiles()

    for (const folderFsPath in testFiles) {
      const files = testFiles[folderFsPath]
      for (const file of files)
        this.getOrCreateFileTestItem(file)
    }

    this.controller.items.delete(this.loaderItem.id)

    return testFiles
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

  getOrCreateFileTestItem(file: string) {
    const cached = this.fileItems.get(file)
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
    this.fileItems.set(file, testFileItem)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri)
    if (!workspaceFolder)
      throw new Error(`Cannot find workspace folder for ${fileUri.toString()}`)
    addTestData(
      testFileItem,
      new TestFile(testFileItem, workspaceFolder),
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

  async watchTestFilesInWorkspace() {
    this.watchers.forEach(x => x.dispose())
    this.watchers = []

    const files = await this.discoverAllTestFiles()

    for (const folderFsPath in files) {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderFsPath))
      if (!folder) {
        log.error(`Cannot find workspace folder for ${folderFsPath}`)
        continue
      }
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folderFsPath, '**/*'),
      )
      this.watchers.push(watcher)

      // TODO: implement these, debounce discovery
      // watcher.onDidCreate(file => this.discoverTestFromFile(controller, file))
      // watcher.onDidChange(async (uri) => {
      //   const metadata = await this.api.getTestMetadata(uri.fsPath)
      //   if (!metadata)
      //     return
      //   const { data } = this.getOrCreateFile(controller, uri, folder)
      //   if (!data.resolved)
      //     return

      //   await data.updateFromDisk(controller, folder)
      // })
      watcher.onDidDelete((file) => {
        const item = this.fileItems.get(normalize(file.fsPath))
        if (item)
          this.recursiveDelete(this.controller.items, item)
      })
    }
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
    const data = getTestData(testItem) as TestFile
    const api = this.api.get(data.workspaceFolder)
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

  async discoverTestsFromDoc(doc: vscode.TextDocument) {
    const fsPath = normalize(doc.uri.fsPath)
    const testItem = this.fileItems.get(fsPath)
    if (!testItem || testItem.busy || testItem.children.size > 0)
      return null
    await this.discoverFileTests(testItem)
    return testItem
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

  collectFile(file: File) {
    const fileTestItem = this.getOrCreateFileTestItem(file.filepath)
    fileTestItem.children.replace([])
    this.flatTestItems.set(file.id, fileTestItem)
    this.collectTasks(file.tasks, fileTestItem)
  }

  collectTasks(tasks: Task[], item: vscode.TestItem) {
    for (const task of tasks) {
      if (this.flatTestItems.has(task.id)) {
        const item = this.flatTestItems.get(task.id)
        item?.parent?.children.delete(task.id)
      }

      const testItem = this.controller.createTestItem(
        task.id,
        task.name,
        item.uri,
      )
      this.flatTestItems.set(task.id, testItem)
      item.children.add(testItem)
      if (task.type === 'suite')
        addTestData(testItem, new TestSuite(testItem))
      else if (task.type === 'test' || task.type === 'custom')
        addTestData(testItem, new TestCase(testItem))

      if ('tasks' in task)
        this.collectTasks(task.tasks, testItem)
    }
  }
}
