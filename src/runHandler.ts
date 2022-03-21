import { resolve } from "path";
import * as vscode from "vscode";
import { getVitestPath as getVitestPath, TestRunner } from "./pure/runner";
import {
  getAllTestCases,
  WEAKMAP_TEST_DATA,
  getTestCaseId,
  TestFile,
} from "./TestData";

export async function debugHandler(
  ctrl: vscode.TestController,
  request: vscode.TestRunRequest
) {
  if (
    vscode.workspace.workspaceFolders === undefined ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  const tests = request.include ?? [];
  if (tests.length === 1) {
    await debugTest(vscode.workspace.workspaceFolders[0], tests[0]);
  } else {
    await debugTest(vscode.workspace.workspaceFolders[0]);
  }
}

async function debugTest(
  workspaceFolder: vscode.WorkspaceFolder,
  testItem?: vscode.TestItem
) {
  let config = {
    type: "pwa-node",
    request: "launch",
    name: "Debug Current Test File",
    autoAttachChildProcesses: true,
    skipFiles: ["<node_internals>/**", "**/node_modules/**"],
    program: getVitestPath(workspaceFolder.uri.path),
    args: [] as string[],
    smartStep: true,
    console: "integratedTerminal",
  };

  if (testItem) {
    const data = WEAKMAP_TEST_DATA.get(testItem);
    if (!data) {
      console.error("Item not found");
      return;
    }

    config.args = [
      "run",
      data.getFilePath(),
      "--testNamePattern",
      data.getFullPattern(),
    ];
  } else {
    config.args = ["run"];
  }

  if (config.program == null) {
    vscode.window.showErrorMessage("Cannot find vitest");
    return;
  }

  try {
    vscode.debug.startDebugging(workspaceFolder, config);
  } catch (e) {
    console.error(`startDebugging error ${(e as any).toString()}`);
  }
}

export async function runHandler(
  ctrl: vscode.TestController,
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken
) {
  if (
    vscode.workspace.workspaceFolders === undefined ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  const runner = new TestRunner(
    vscode.workspace.workspaceFolders[0].uri.path,
    getVitestPath(vscode.workspace.workspaceFolders[0].uri.path)
  );

  const tests = request.include ?? gatherTestItems(ctrl.items);
  const run = ctrl.createTestRun(request);
  await Promise.allSettled(
    tests.map((test) => runTest(ctrl, runner, run, test))
  );
  run.end();
}

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}

async function runTest(
  ctrl: vscode.TestController,
  runner: TestRunner,
  run: vscode.TestRun,
  item: vscode.TestItem
) {
  const testingData = WEAKMAP_TEST_DATA.get(item);
  if (!testingData) {
    console.error("Item not found");
    throw new Error("Item not found");
  }

  if (testingData instanceof TestFile) {
    await testingData.load(ctrl);
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

  try {
    const data = WEAKMAP_TEST_DATA.get(item)!;
    const out = await runner.scheduleRun(
      item.uri!.fsPath,
      data.getFullPattern()
    );
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
  } catch (e) {
    run.errored(item, new vscode.TestMessage((e as any).toString()));
  }
}
