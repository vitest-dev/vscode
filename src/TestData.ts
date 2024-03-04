import type * as vscode from 'vscode'
import { discoverTestFromFileContent } from './discover'
import { getContentFromFilesystem } from './vscodeUtils'
import { transformTestPattern } from './pure/testName'

export const WEAKMAP_TEST_DATA = new WeakMap<vscode.TestItem, TestData>()
export const WEAKMAP_TEST_FOLDER = new WeakMap<vscode.TestItem, vscode.WorkspaceFolder>()
// FIXME: GC
export const testItemIdMap = new WeakMap<
  vscode.TestController,
  Map<string, vscode.TestItem>
>()

export function getTestItemFolder(item: vscode.TestItem) {
  return WEAKMAP_TEST_FOLDER.get(item)!
}

export type TestData = TestFile | TestDescribe | TestCase

export function getTestCaseId(
  childItem: vscode.TestItem,
  name: string,
): string | undefined {
  const data = WEAKMAP_TEST_DATA.get(childItem)
  if (data instanceof TestDescribe || data instanceof TestCase) {
    return `${data.fileItem.uri}/${name}`
  }
  else {
    if (childItem == null)
      return undefined

    return `${childItem.uri}/${name}`
  }
}

export function getAllTestCases(
  item: vscode.TestItem,
  agg: vscode.TestItem[] = [],
) {
  if (item.children.size) {
    item.children.forEach((child) => {
      getAllTestCases(child, agg)
    })
  }
  else if (WEAKMAP_TEST_DATA.get(item) instanceof TestCase) {
    agg.push(item)
  }
  return agg
}

export class TestDescribe {
  children: (TestDescribe | TestCase)[] = []
  readonly nameResolver: TaskName
  constructor(
    readonly name: string,
    readonly isEach: boolean,
    readonly fileItem: vscode.TestItem,
    readonly item: vscode.TestItem,
    readonly parent: TestDescribe | TestFile,
  ) {
    this.nameResolver = new TaskName(this)
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath
  }
}

export class TestCase {
  readonly nameResolver: TaskName
  constructor(
    readonly name: string,
    readonly isEach: boolean,
    readonly fileItem: vscode.TestItem,
    readonly item: vscode.TestItem,
    readonly parent: TestDescribe | TestFile,
    readonly index: number,
  ) {
    this.nameResolver = new TaskName(this)
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath
  }
}

export class TestFile {
  resolved = false
  children: (TestDescribe | TestCase)[] = []
  nameResolver: undefined
  constructor(public item: vscode.TestItem) {}
  public async updateFromDisk(controller: vscode.TestController, folder?: vscode.WorkspaceFolder) {
    const item = this.item
    try {
      const content = await getContentFromFilesystem(item.uri!)
      this.item.error = undefined
      discoverTestFromFileContent(controller, content, item, this, folder || WEAKMAP_TEST_FOLDER.get(item)!)
      this.resolved = true
    }
    catch (e) {
      this.item.error = (e as Error).stack
    }
  }

  load(ctrl: vscode.TestController, folder: vscode.WorkspaceFolder): Promise<void> | undefined {
    if (this.resolved)
      return

    return this.updateFromDisk(ctrl, folder)
  }

  getFilePath(): string {
    return this.item.uri!.fsPath
  }
}

class TaskName {
  public readonly pattern: string
  public readonly regexp: RegExp
  constructor(readonly start: TestCase | TestDescribe) {
    this.pattern = transformTestPattern({
      testName: start.name,
      isEach: start.isEach,
    })
    this.regexp = new RegExp(`^${this.pattern}$`)
  }

  asVitestArgs(): string {
    if (this.start instanceof TestCase)
      return `^${this.join()}$`
    else
      return `^${this.join()}`
  }

  asFullMatchPattern(): string {
    return `^${this.join()}$`
  }

  private join(): string {
    const patterns = [this.start.nameResolver.pattern]
    let iter = this.start.parent
    while (iter instanceof TestDescribe) {
      patterns.unshift(iter.nameResolver.pattern)
      iter = iter.parent
    }
    // vitest's test task name starts with ' ' of root suite
    // It's considered as a bug, but it's not fixed yet for backward compatibility
    return `\\s?${patterns.join(' ')}`
  }
}
