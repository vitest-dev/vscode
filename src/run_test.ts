import * as vscode from "vscode";
import { TestRunner } from "./pure/runner";
import {
  getAllTestCases,
  WEAKMAP_TEST_DATA,
  getTestCaseId,
  TestFile,
} from "./test_data";

export async function runTest(
  runner: TestRunner,
  run: vscode.TestRun,
  item: vscode.TestItem
) {
  const testingData = WEAKMAP_TEST_DATA.get(item);
  if (!testingData) {
    throw new Error("file item not found");
  }

  let file: TestFile;
  if (testingData instanceof TestFile) {
    file = testingData;
  } else {
    file = WEAKMAP_TEST_DATA.get(testingData.fileItem) as TestFile;
    if (!file) {
      throw new Error("file item not found");
    }
  }

  const testCaseSet = new Set(getAllTestCases(item));
  const idMap = new Map<string, vscode.TestItem>();
  testCaseSet.forEach((testCase) => {
    run.started(testCase);
    idMap.set(testCase.id, testCase);
  });

  const data = WEAKMAP_TEST_DATA.get(item)!;
  const out = await runner.scheduleRun(item.uri!.fsPath, data.getFullPattern());
  out.testResults.forEach((result, index) => {
    let child: undefined | vscode.TestItem = file.testCases[index];
    const id = getTestCaseId(item, result.displayName!) || "";
    if (!child || child.id !== id) {
      child = idMap.get(id);
      console.error("not match");
      console.dir(out.testResults);
      console.dir(file.testCases);
    }

    if (!child || !testCaseSet.has(child)) {
      return;
    }

    testCaseSet.delete(child);
    switch (result.status) {
      case "pass":
        run.passed(child, result.perfStats?.runtime);
        return;
      case "fail":
        run.failed(child, new vscode.TestMessage(result.failureMessage || ""));
        return;
    }

    if (result.skipped || result.status == null) {
      run.skipped(child);
    }
  });

  testCaseSet.forEach((testCase) => {
    run.skipped(testCase);
    run.appendOutput(`Cannot find test ${testCase.id}`);
  });

  run.end();
}
