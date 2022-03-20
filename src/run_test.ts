import * as vscode from "vscode";
import { TestRunner } from "./pure/runner";
import { getAllTestCases, testData, getTestCaseId } from "./test_data";

export async function runTest(
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
  const out = await runner.scheduleRun(item.uri!.fsPath, data.getFullPattern());
  out.testResults.forEach((result) => {
    const id = getTestCaseId(item, result.displayName!) || "";
    const child = idMap.get(id);
    if (!child) {
      return;
    }

    testCases.delete(child);
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

  testCases.forEach((testCase) => {
    run.skipped(testCase);
    run.appendOutput(`Cannot find test ${testCase.id}`);
  });

  run.end();
}
