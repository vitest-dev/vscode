import * as vscode from "vscode";
import { getVitestPath as getVitestPath, TestRunner } from "./pure/runner";
import groupBy = require("lodash.groupby");
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
  await runTest(ctrl, runner, run, tests);
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
  items: readonly vscode.TestItem[]
) {
  const testCaseSet: Set<vscode.TestItem> = new Set();
  const fileToTestCasesMap = new Map<string, vscode.TestItem[]>();
  const fileItems: vscode.TestItem[] = [];
  for (const item of items) {
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

    fileItems.push(file);
    const fileTestCases = getAllTestCases(file);
    fileToTestCasesMap.set(item.uri!.path, fileTestCases);
    for (const test of getAllTestCases(item)) {
      testCaseSet.add(test);
    }
  }

  testCaseSet.forEach((testCase) => {
    run.enqueued(testCase);
    run.started(testCase);
  });

  const pathToFile = new Map<string, vscode.TestItem>();
  for (const file of fileItems) {
    pathToFile.set(file.uri!.path, file);
  }

  try {
    const out = await runner.scheduleRun(
      fileItems.map((x) => x.uri!.fsPath),
      items.length === 1
        ? WEAKMAP_TEST_DATA.get(items[0])!.getFullPattern()
        : "",
      items.length === 1
        ? (msg) => run.appendOutput(msg, undefined, items[0])
        : (msg) => run.appendOutput(msg)
    );
    if (out.testResults.length !== 0) {
      Object.values(groupBy(out.testResults, (x) => x.testFilePath)).forEach(
        (results) => {
          results.forEach((result, index) => {
            const fileTestCases = fileToTestCasesMap.get(result.testFilePath!)!;
            /**
             * ATTENTION: Current implementation assumes that testResults are ordered by
             * original test case position for each test file
             */
            let child: undefined | vscode.TestItem = fileTestCases[index];
            const id =
              getTestCaseId(
                pathToFile.get(result.testFilePath!)!,
                result.displayName!
              ) || "";
            if (!child || !child.id.startsWith(id)) {
              console.error("not match");
              throw new Error("not match");
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
        }
      );
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
    console.error(e);
    run.appendOutput("Run test failed " + (e as Error).toString());
  }
}
