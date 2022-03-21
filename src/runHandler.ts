import * as vscode from "vscode";
import { getVitestPath as getVitestPath, TestRunner } from "./pure/runner";
import {
  getAllTestCases,
  WEAKMAP_TEST_DATA,
  getTestCaseId,
  TestFile,
} from "./TestData";

export async function runHandler(
  ctrl: vscode.TestController,
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken
) {
  if (vscode.workspace.workspaceFolders === undefined) {
    return;
  }

  const runner = new TestRunner(
    vscode.workspace.workspaceFolders[0].uri.path,
    getVitestPath(vscode.workspace.workspaceFolders[0].uri.path)
  );

  const tests = request.include ?? gatherTestItems(ctrl.items);
  const run = ctrl.createTestRun(request);
  await Promise.allSettled(tests.map((test) => runTest(runner, run, test)));
  run.end();
}

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}

async function runTest(
  runner: TestRunner,
  run: vscode.TestRun,
  item: vscode.TestItem
) {
  const testingData = WEAKMAP_TEST_DATA.get(item);
  if (!testingData) {
    throw new Error("file item not found");
  }

  let file: vscode.TestItem;
  if (testingData instanceof TestFile) {
    file = item;
  } else {
    file = testingData.fileItem;
    if (!file) {
      throw new Error("file item not found");
    }
  }

  const fileTestCases = getAllTestCases(file);
  const testCaseSet = new Set(getAllTestCases(item));
  testCaseSet.forEach((testCase) => {
    run.enqueued(testCase);
    run.started(testCase);
  });

  const data = WEAKMAP_TEST_DATA.get(item)!;
  const out = await runner.scheduleRun(item.uri!.fsPath, data.getFullPattern());
  if (out.testResults.length !== 0) {
    out.testResults.forEach((result, index) => {
      let child: undefined | vscode.TestItem = fileTestCases[index];
      const id = getTestCaseId(item, result.displayName!) || "";
      if (!child || !child.id.startsWith(id)) {
        console.error("not match");
        console.dir(out.testResults);
        console.dir(fileTestCases);
        throw new Error();
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
          run.failed(
            child,
            new vscode.TestMessage(result.failureMessage || "")
          );
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
  } else {
    testCaseSet.forEach((testCase) => {
      run.errored(
        testCase,
        new vscode.TestMessage(
          "Testing is not started correctly. Please check your configuration."
        )
      );
    });
  }
}
