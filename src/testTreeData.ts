import type * as vscode from 'vscode'

export type TestData = TestFolder | TestFile | TestCase | TestSuite

const WEAKMAP_TEST_DATA = new WeakMap<vscode.TestItem, TestData>()

export function getTestData(item: vscode.TestItem): TestData {
  return WEAKMAP_TEST_DATA.get(item)!
}

export function addTestData(item: vscode.TestItem, data: TestData) {
  WEAKMAP_TEST_DATA.set(item, data)
}

export class TestFolder {
  constructor(
    public readonly item: vscode.TestItem,
  ) {}
}

export class TestFile {
  constructor(
    public readonly item: vscode.TestItem,
    public readonly workspaceFolder: vscode.WorkspaceFolder,
  ) {}
}

class TaskName {
  constructor(
    private readonly data: TestData,
  ) {}

  getTestNamePattern() {
    const patterns = [this.data.item.label]
    let iter = this.data.item.parent
    while (iter) {
      // if we reached test file, then stop
      const data = getTestData(iter)
      if (data instanceof TestFile || data instanceof TestFolder)
        break
      patterns.push(iter.label)
      iter = iter.parent
    }
    // vitest's test task name starts with ' ' of root suite
    // It's considered as a bug, but it's not fixed yet for backward compatibility
    return `\\s?${patterns.reverse().join(' ')}`
  }
}

export class TestCase {
  private nameResolver: TaskName

  constructor(
    public readonly item: vscode.TestItem,
  ) {
    this.nameResolver = new TaskName(this)
  }

  getTestNamePattern() {
    return `^${this.nameResolver.getTestNamePattern()}$`
  }
}

export class TestSuite {
  private nameResolver: TaskName

  constructor(
    public readonly item: vscode.TestItem,
  ) {
    this.nameResolver = new TaskName(this)
  }

  getTestNamePattern() {
    return `^${this.nameResolver.getTestNamePattern()}`
  }
}
