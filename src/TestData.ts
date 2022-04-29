import * as vscode from "vscode";
import { discoverTestFromFileContent } from "./discover";
import { getContentFromFilesystem } from "./vscodeUtils";

export const WEAKMAP_TEST_DATA = new WeakMap<vscode.TestItem, TestData>();
// FIXME: GC
export const testItemIdMap = new WeakMap<
  vscode.TestController,
  Map<string, vscode.TestItem>
>();

export type TestData = TestFile | TestDescribe | TestCase;

export function getTestCaseId(
  childItem: vscode.TestItem,
  name: string,
): string | undefined {
  const data = WEAKMAP_TEST_DATA.get(childItem);
  if (data instanceof TestDescribe || data instanceof TestCase) {
    return `${data.fileItem.uri}/${name}`;
  } else {
    if (childItem == null) {
      return undefined;
    }

    return `${childItem.uri}/${name}`;
  }
}

export function getAllTestCases(
  item: vscode.TestItem,
  agg: vscode.TestItem[] = [],
) {
  if (item.children.size) {
    item.children.forEach((child) => {
      getAllTestCases(child, agg);
    });
  } else if (WEAKMAP_TEST_DATA.get(item) instanceof TestCase) {
    agg.push(item);
  }
  return agg;
}

export class TestDescribe {
  constructor(
    public pattern: string,
    public fileItem: vscode.TestItem,
    public parent: TestDescribe | TestFile,
  ) {}

  getFullPattern(): string {
    return getFullPattern(this);
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath;
  }
}

export class TestCase {
  constructor(
    public pattern: string,
    public fileItem: vscode.TestItem,
    public parent: TestDescribe | TestFile,
    public index: number,
  ) {}

  getFullPattern(): string {
    return getFullPattern(this);
  }

  getFilePath(): string {
    return this.fileItem.uri!.fsPath;
  }
}

export class TestFile {
  resolved = false;
  pattern = "";
  constructor(public item: vscode.TestItem) {}
  public async updateFromDisk(controller: vscode.TestController) {
    const item = this.item;
    try {
      const content = await getContentFromFilesystem(item.uri!);
      this.item.error = undefined;
      discoverTestFromFileContent(controller, content, item, this);
      this.resolved = true;
    } catch (e) {
      this.item.error = (e as Error).stack;
    }
  }

  load(ctrl: vscode.TestController): Promise<void> | undefined {
    if (this.resolved) {
      return;
    }

    return this.updateFromDisk(ctrl);
  }

  getFullPattern(): string {
    return "";
  }

  getFilePath(): string {
    return this.item.uri!.fsPath;
  }
}

function getFullPattern(start: TestDescribe | TestCase): string {
  const parents: TestDescribe[] = [];
  let iter = start.parent;
  while (iter && iter instanceof TestDescribe) {
    parents.push(iter);
    iter = iter.parent;
  }

  parents.reverse();
  if (parents.length) {
    return parents.reduce((a, b) => a + b.pattern + " ", "") + start.pattern;
  } else {
    return start.pattern;
  }
}
