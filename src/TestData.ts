import type * as vscode from 'vscode'
import { discoverTestFromFileContent } from './discover'
import { getContentFromFilesystem } from './vscodeUtils'
import { transformTestPattern } from './pure/testName'

export const WEAKMAP_TEST_DATA = new WeakMap<vscode.TestItem, TestData>()
// FIXME: GC
export const testItemIdMap = new WeakMap<
  vscode.TestController,
  Map<string, vscode.TestItem>
>()

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
  readonly processedName: string
  constructor(
    readonly rawName: string,
    readonly isEach: boolean,
    readonly fileItem: vscode.TestItem,
    readonly item: vscode.TestItem,
    readonly parent: TestDescribe | TestFile,
  ) {
    this.processedName = transformTestPattern({testName: rawName, isEach})
  }

  getRawFullPattern(): string {
    return getFullPattern(this, 'rawName')
  }

  getFullPattern(): string {
    return getFullPattern(this, 'processedName')
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath
  }
}

export class TestCase {
  readonly processedName: string
  constructor(
    readonly rawName: string,
    readonly isEach: boolean,
    readonly fileItem: vscode.TestItem,
    readonly item: vscode.TestItem,
    readonly parent: TestDescribe | TestFile,
    readonly index: number,
  ) {
    this.processedName = transformTestPattern({testName: rawName, isEach})
  }

  getRawFullPattern(): string {
    return getFullPattern(this, 'rawName')
  }

  getFullPattern(): string {
    return getFullPattern(this, 'processedName')
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath
  }
}

export class TestFile {
  resolved = false
  pattern = ''
  children: (TestDescribe | TestCase)[] = []
  constructor(public item: vscode.TestItem) {}
  public async updateFromDisk(controller: vscode.TestController) {
    const item = this.item
    try {
      const content = await getContentFromFilesystem(item.uri!)
      this.item.error = undefined
      discoverTestFromFileContent(controller, content, item, this)
      this.resolved = true
    }
    catch (e) {
      this.item.error = (e as Error).stack
    }
  }

  load(ctrl: vscode.TestController): Promise<void> | undefined {
    if (this.resolved)
      return

    return this.updateFromDisk(ctrl)
  }

  getFullPattern(): string {
    return ''
  }

  getFilePath(): string {
    return this.item.uri!.fsPath
  }
}

function getFullPattern(
  start: TestDescribe | TestCase,
  key: 'processedName' | 'rawName'
): string {
  const parents: TestDescribe[] = []
  let iter = start.parent
  while (iter && iter instanceof TestDescribe) {
    parents.push(iter)
    iter = iter.parent
  }

  parents.reverse()
  if (parents.length)
    return parents.reduce((a, b) => `${a + b[key]} `, '') + start[key]
  else
    return start[key]
}
