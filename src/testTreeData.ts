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

export class TestFile extends BaseTestData {
  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly filepath: string,
    public readonly api: VitestFolderAPI,
    public readonly project: string,
  ) {
    super(item, parent)
  }

  public static register(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    filepath: string,
    api: VitestFolderAPI,
    project: string,
  ) {
    return addTestData(item, new TestFile(item, parent, filepath, api, project))
  }
}

class TaskName {
  constructor(
    private readonly data: TestData,
  ) {}

  getTestNamePattern() {
    const patterns = [escapeRegex(this.data.label)]
    let iter = this.data.parent
    while (iter) {
      // if we reached test file, then stop
      if (iter instanceof TestFile || iter instanceof TestFolder)
        break
      patterns.push(escapeRegex(iter.label))
      iter = iter.parent
    }
    // vitest's test task name starts with ' ' of root suite
    // It's considered as a bug, but it's not fixed yet for backward compatibility
    return `\\s?${patterns.reverse().join(' ')}`
  }
}

export class TestCase extends BaseTestData {
  private nameResolver: TaskName

  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly file: TestFile,
  ) {
    super(item, parent)
    this.nameResolver = new TaskName(this)
  }

  public static register(item: vscode.TestItem, parent: vscode.TestItem, file: TestFile) {
    return addTestData(item, new TestCase(item, parent, file))
  }

  getTestNamePattern() {
    return `^${this.nameResolver.getTestNamePattern()}$`
  }
}

export class TestSuite extends BaseTestData {
  private nameResolver: TaskName

  private constructor(
    item: vscode.TestItem,
    parent: vscode.TestItem,
    public readonly file: TestFile,
  ) {
    super(item, parent)
    this.nameResolver = new TaskName(this)
  }

  public static register(item: vscode.TestItem, parent: vscode.TestItem, file: TestFile) {
    return addTestData(item, new TestSuite(item, parent, file))
  }

  getTestNamePattern() {
    return `^${this.nameResolver.getTestNamePattern()}`
  }
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
