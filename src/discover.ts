import { sep } from 'node:path'
import * as vscode from 'vscode'
import type { TestData } from './TestData'
import {
  TestCase,
  TestDescribe,
  TestFile,
  WEAKMAP_TEST_DATA,
  WEAKMAP_TEST_FOLDER,
  testItemIdMap,
} from './TestData'
import parse from './pure/parsers'
import type { NamedBlock } from './pure/parsers/parser_nodes'
import { log } from './log'
import { openTestTag } from './tags'
import type { VitestAPI } from './api'

export class TestFileDiscoverer extends vscode.Disposable {
  private workspaceCommonPrefix: Map<string, string> = new Map()
  private workspaceItems: Map<string, Set<vscode.TestItem>> = new Map()
  private pathToFileItem: Map<string, TestFile> = new Map()

  private watchers: vscode.FileSystemWatcher[] = []

  constructor(
    private readonly api: VitestAPI,
  ) {
    super(() => {
      this.watchers.forEach(x => x.dispose())
      this.watchers = []
      this.workspaceItems.clear()
      this.pathToFileItem.clear()
      this.workspaceCommonPrefix.clear()
    })
    this.api = api
    // this.workspacePaths
    //   = vscode.workspace.workspaceFolders?.map(x => x.uri.fsPath) || []
  }

  async watchTestFilesInWorkspace(
    controller: vscode.TestController,
  ) {
    this.watchers.forEach(x => x.dispose())
    this.watchers = []

    const files = await this.discoverAllTestFilesInWorkspace(controller)
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

      watcher.onDidCreate(file => this.discoverTestFromFile(controller, file))
      watcher.onDidChange(async (uri) => {
        const metadata = await this.api.getTestMetadata(uri.fsPath)
        if (!metadata)
          return
        const { data } = this.getOrCreateFile(controller, uri, folder)
        if (!data.resolved)
          return

        await data.updateFromDisk(controller, folder)
      })
      watcher.onDidDelete(file => controller.items.delete(file.toString()))
    }
  }

  async discoverAllTestFilesInWorkspace(
    controller: vscode.TestController,
  ): Promise<Record<string, string[]>> {
    const files = await this.api.getFiles()
    for (const folderFsPath in files) {
      const testFiles = files[folderFsPath]
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folderFsPath))
      if (!folder) {
        log.error(`Cannot find workspace folder for ${folderFsPath}`)
        continue
      }
      for (const file of testFiles) {
        this.getOrCreateFile(controller, vscode.Uri.file(file), folder).data.updateFromDisk(
          controller,
          folder,
        )
      }
    }
    return files
  }

  public async discoverTestFromFile(
    controller: vscode.TestController,
    file: vscode.Uri,
  ) {
    const metadata = await this.api.getTestMetadata(file.fsPath)
    if (metadata) {
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(metadata.folder))
      if (folder)
        this.getOrCreateFile(controller, file, folder)
    }
  }

  public async discoverTestFromDoc(
    ctrl: vscode.TestController,
    e: vscode.TextDocument,
  ) {
    if (e.uri.scheme !== 'file')
      return

    const testFileData = await this.api.getTestMetadata(e.uri.fsPath)
    if (!testFileData)
      return
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(testFileData.folder))
    if (!folder)
      return

    const { file, data } = this.getOrCreateFile(ctrl, e.uri, folder)
    discoverTestFromFileContent(ctrl, e.getText(), file, data, folder)

    return file
  }

  private getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder) {
    const existing = controller.items.get(uri.toString())
    if (existing) {
      return {
        file: existing,
        data: WEAKMAP_TEST_DATA.get(existing) as TestFile,
      }
    }

    const workspacePath = workspaceFolder.uri.fsPath
    let name
    if (workspacePath) {
      if (!this.workspaceCommonPrefix.has(workspacePath)) {
        const path = uri.fsPath.split(sep)
        this.workspaceCommonPrefix.set(
          workspacePath,
          path.slice(0, -1).join(sep) + sep,
        )
        this.workspaceItems.set(workspacePath, new Set())
      }

      let workspacePrefix = this.workspaceCommonPrefix.get(workspacePath)!
      if (!uri.fsPath.startsWith(workspacePrefix)) {
        const p = uri.fsPath
        for (let i = 0; i < workspacePrefix.length; i++) {
          if (p[i] !== workspacePrefix[i]) {
            workspacePrefix = workspacePrefix.slice(0, i)
            break
          }
        }

        this.workspaceCommonPrefix.set(workspacePath, workspacePrefix)
        const items = this.workspaceItems.get(workspacePath)!
        items.forEach((v) => {
          v.label = v.uri!.fsPath.substring(workspacePrefix.length)
        })
      }

      name = uri.fsPath.substring(workspacePrefix.length)
    }
    else {
      name = uri.fsPath.split(sep).pop()!
    }

    const file = controller.createTestItem(uri.toString(), name, uri)
    workspacePath && this.workspaceItems.get(workspacePath)!.add(file)
    controller.items.add(file)
    const data = new TestFile(file)
    WEAKMAP_TEST_FOLDER.set(file, workspaceFolder)
    WEAKMAP_TEST_DATA.set(file, data)
    this.pathToFileItem.set(uri.fsPath, data)

    file.canResolveChildren = true
    return { file, data }
  }
}

export function discoverTestFromFileContent(
  controller: vscode.TestController,
  content: string,
  fileItem: vscode.TestItem,
  data: TestFile,
  folder: vscode.WorkspaceFolder,
) {
  if (testItemIdMap.get(controller) == null)
    testItemIdMap.set(controller, new Map())

  const idMap = testItemIdMap.get(controller)!
  idMap.set(fileItem.id, fileItem)
  const ancestors = [
    {
      item: fileItem,
      block: undefined as NamedBlock | undefined,
      children: [] as vscode.TestItem[],
      dataChildren: [] as (TestCase | TestDescribe)[],
      data: data as TestData,
    },
  ]

  function getParent(block: NamedBlock): typeof ancestors[number] {
    let parent = ancestors[ancestors.length - 1]
    if (parent.block == null)
      return parent

    while (parent.block && block.start!.line >= parent.block.end!.line) {
      const top = ancestors.pop()
      if (top) {
        top.item.children.replace(top.children);
        (top.data as (TestFile | TestDescribe)).children = [
          ...top.dataChildren,
        ]
      }

      parent = ancestors[ancestors.length - 1]
    }

    return parent
  }

  let result: ReturnType<typeof parse>
  try {
    result = parse(fileItem.id, content)
  }
  catch (e) {
    log.error('parse error', fileItem.id, e)
    return
  }

  const arr: NamedBlock[] = [...result.describeBlocks, ...result.itBlocks]
  arr.sort((a, b) => (a.start?.line || 0) - (b.start?.line || 0))
  let testCaseIndex = 0
  let index = 0
  for (const block of arr) {
    const parent = getParent(block)
    const fullName = ancestors.slice(1).map(x => x.block?.name || '').concat([
      block.name!,
    ]).join(' ').trim()
    const id = `${fileItem.uri}/${fullName}@${index++}`
    const caseItem = controller.createTestItem(id, block.name!, fileItem.uri)
    WEAKMAP_TEST_FOLDER.set(caseItem, folder)
    idMap.set(id, caseItem)
    caseItem.range = new vscode.Range(
      new vscode.Position(block.start!.line - 1, block.start!.column),
      new vscode.Position(block.end!.line - 1, block.end!.column),
    )
    parent.children.push(caseItem)
    if (block.type === 'describe') {
      const isEach = block.lastProperty === 'each'
      const data = new TestDescribe(
        block.name!,
        isEach,
        fileItem,
        caseItem,
        parent.data as TestFile,
      )
      parent.dataChildren.push(data)
      WEAKMAP_TEST_DATA.set(caseItem, data)
      ancestors.push({
        item: caseItem,
        block,
        children: [],
        data,
        dataChildren: [],
      })
    }
    else if (block.type === 'it') {
      const isEach = block.lastProperty === 'each'
      const testCase = new TestCase(
        block.name!,
        isEach,
        fileItem,
        caseItem,
        parent.data as TestFile | TestDescribe,
        testCaseIndex++,
      )
      parent.dataChildren.push(testCase)
      WEAKMAP_TEST_DATA.set(caseItem, testCase)
    }
    else {
      throw new Error('unexpected block type')
    }
  }

  while (ancestors.length) {
    const top = ancestors.pop()
    if (top) {
      top.item.children.replace(top.children);
      (top.data as (TestFile | TestDescribe)).children = [
        ...top.dataChildren,
      ]
    }
  }

  const childTestItems = [fileItem]
  const allTestItems = new Array<vscode.TestItem>()

  while (childTestItems.length) {
    const child = childTestItems.pop()
    if (!child)
      continue

    allTestItems.push(child)
    childTestItems.push(...[...child.children].map(x => x[1]))
  }

  const isFileOpen = vscode.workspace.textDocuments.some(
    x => x.uri.fsPath === fileItem.uri?.fsPath,
  )
  const existingTagsWithoutOpenTag = fileItem.tags.filter(
    x => x !== openTestTag,
  )
  const newTags = isFileOpen
    ? [...existingTagsWithoutOpenTag, openTestTag]
    : existingTagsWithoutOpenTag
  for (const testItem of allTestItems)
    testItem.tags = newTags
}
