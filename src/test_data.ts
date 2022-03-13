import * as vscode from "vscode";
import { discoverTestFromFileContent } from "./discover";
import { TestRunner } from "./pure/runner";
import { getContentFromFilesystem } from "./vscode_utils";

export const testData = new WeakMap<vscode.TestItem, TestData>();
export const testItemIdMap = new WeakMap<
  vscode.TestController,
  Map<string, vscode.TestItem>
>();

export type TestData = TestFile | TestDescribe | TestCase;

function getTestCaseId(
  childItem: vscode.TestItem,
  name: string
): string | undefined {
  const data = testData.get(childItem);
  if (data instanceof TestDescribe || data instanceof TestCase) {
    return `${data.fileItem.uri}/${name}`;
  } else {
    return `${childItem.uri}/${name}`;
  }
}

export async function runTest(
  ctrl: vscode.TestController,
  runner: TestRunner,
  run: vscode.TestRun,
  item: vscode.TestItem
) {
  const testCases = new Set(getAllTestCases(item));
  const idMap = new Map<string, vscode.TestItem>();
  testCases.forEach((testCase) => {
    run.started(testCase);
    idMap.set(testCase.id, testCase);
  });

  const data = testData.get(item)!;
  const out = await runner.scheduleRun(item.uri!.fsPath, data.pattern);
  console.log(out.testResults);
  out.testResults.forEach((result) => {
    const id = getTestCaseId(item, result.displayName!) || "";
    const child = idMap.get(id);
    if (!child) {
      return;
    }

    testCases.delete(child);
    switch (result.status) {
      case "pass":
        run.passed(child);
        return;
      case "fail":
        run.failed(child, new vscode.TestMessage(result.failureMessage || ""));
        return;
    }

    if (result.skipped || result.status == null) {
      run.skipped(child);
    }
  });

  testCases.forEach((testCase) => {
    run.skipped(testCase);
    run.appendOutput(`Cannot find test ${testCase.id}`);
  });

  run.end();
}

function getAllTestCases(item: vscode.TestItem, agg: vscode.TestItem[] = []) {
  if (item.children.size) {
    item.children.forEach((child) => {
      getAllTestCases(child, agg);
    });
  } else {
    agg.push(item);
  }
  return agg;
}

export class TestDescribe {
  constructor(public pattern: string, public fileItem: vscode.TestItem) {}
}
export class TestCase {
  constructor(public pattern: string, public fileItem: vscode.TestItem) {}
}

export class TestFile {
  resolved = false;
  pattern = "";
  public async updateFromDisk(
    controller: vscode.TestController,
    item: vscode.TestItem
  ) {
    try {
      const content = await getContentFromFilesystem(item.uri!);
      item.error = undefined;
      discoverTestFromFileContent(controller, content, item);
      this.resolved = true;
    } catch (e) {
      item.error = (e as Error).stack;
    }
  }
}
