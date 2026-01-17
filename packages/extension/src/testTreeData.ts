import type * as vscode from 'vscode'
import type { VitestFolderAPI } from './api'

export type TestData = TestFolder | TestFile | TestCase | TestSuite

const WEAKMAP_TEST_DATA = new WeakMap<vscode.TestItem, TestData>()

export function getTestData(item: vscode.TestItem): TestData {
  const data = WEAKMAP_TEST_DATA.get(item)
  if (!data)
    throw new Error(`Test data not found for "${item.label}". This is a bug in Vitest extension. Please report it to https://github.com/vitest-dev/vscode`)
  return data
}

function addTestData<T extends TestData>(item: vscode.TestItem, data: T): T {
  WEAKMAP_TEST_DATA.set(item, data)
  return data
}

class BaseTestData {
  public readonly label: string
  public readonly parent: TestData | undefined
  public readonly id: string

  constructor(
    item: vscode.TestItem,
    parent?: vscode.TestItem,
  ) {
    this.label = item.label
    this.id = item.id
    this.parent = parent ? WEAKMAP_TEST_DATA.get(parent) : undefined
  }
}

export class TestFolder extends BaseTestData {
  public readonly type = 'folder'

  private constructor(
    item: vscode.TestItem,
    parent?: vscode.TestItem,
  ) {
    super(item, parent)
  }

  public static register(item: vscode.TestItem, parent?: vscode.TestItem) {
    return addTestData(item, new TestFolder(item, parent))
  }
}

export interface TestFileMetadata {
  project: string
  pool: string
  browser?: {
    provider: string
    name: string
    webRoot?: string
  }
}

export class TestFile extends BaseTestData {
  public readonly type = 'file'
  public readonly project: string

  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly filepath: string,
    public readonly api: VitestFolderAPI,
    public readonly metadata: TestFileMetadata,
  ) {
    super(item, parent)
    this.project = metadata.project
  }

  public static register(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    filepath: string,
    api: VitestFolderAPI,
    metadata: TestFileMetadata,
  ) {
    return addTestData(item, new TestFile(item, parent, filepath, api, metadata))
  }
}

class TaskName {
  constructor(
    private readonly data: TestData,
    public readonly dynamic: boolean,
  ) {}

  public get label() {
    return this.data.label
  }

  getTestNamePattern() {
    const patterns = [escapeTestName(this.data.label, this.dynamic)]
    let iter = this.data.parent
    while (iter) {
      // if we reached test file, then stop
      if (iter instanceof TestFile || iter instanceof TestFolder)
        break
      patterns.push(escapeTestName(iter.label, iter.name.dynamic))
      iter = iter.parent
    }
    // vitest's test task name starts with ' ' of root suite
    // It's considered as a bug, but it's not fixed yet for backward compatibility
    return `\\s?${patterns.reverse().join(' ')}`
  }
}

export class TestCase extends BaseTestData {
  public name: TaskName
  public readonly type = 'test'

  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly file: TestFile,
    public readonly dynamic: boolean,
  ) {
    super(item, parent)
    this.name = new TaskName(this, dynamic)
  }

  public static register(item: vscode.TestItem, parent: vscode.TestItem, file: TestFile, dynamic: boolean) {
    return addTestData(item, new TestCase(item, parent, file, dynamic))
  }

  getTestNamePattern() {
    return `^${this.name.getTestNamePattern()}$`
  }
}

export class TestSuite extends BaseTestData {
  public name: TaskName
  public readonly type = 'suite'

  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly file: TestFile,
    dynamic: boolean,
  ) {
    super(item, parent)
    this.name = new TaskName(this, dynamic)
  }

  public static register(item: vscode.TestItem, parent: vscode.TestItem, file: TestFile, dynamic: boolean) {
    return addTestData(item, new TestSuite(item, parent, file, dynamic))
  }

  getTestNamePattern() {
    return `^${this.name.getTestNamePattern()}`
  }
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const kReplacers = new Map<string, string>([
  ['%i', '\\d+?'],
  ['%#', '\\d+?'],
  ['%d', '[\\d.eE+-]+?'],
  ['%f', '[\\d.eE+-]+?'],
  ['%s', '.+?'],
  ['%j', '.+?'],
  ['%o', '.+?'],
  ['%%', '%'],
])

function escapeTestName(label: string, dynamic: boolean) {
  if (!dynamic) {
    return escapeRegex(label)
  }

  // Replace object access patterns ($value, $obj.a) with %s first
  let pattern = label.replace(/\$[a-z_.]+/gi, '%s')
  pattern = escapeRegex(pattern)
  // Replace percent placeholders with their respective regex
  pattern = pattern.replace(/%[i#dfsjo%]/g, m => kReplacers.get(m) || m)
  return pattern
}
