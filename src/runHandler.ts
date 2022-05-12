import * as vscode from "vscode";
import {
  FormattedTestResults,
  getNodeVersion,
  getTempPath,
  TestRunner,
} from "./pure/runner";
import {
  getVitestCommand,
  getVitestPath,
  sanitizeFilePath,
} from "./pure/utils";
import { relative } from "path";
import {
  getAllTestCases,
  getTestCaseId,
  TestFile,
  testItemIdMap,
  WEAKMAP_TEST_DATA,
} from "./TestData";
import { getConfig } from "./config";
import { readFile } from "fs-extra";
import { existsSync } from "fs";

export async function runHandler(
  ctrl: vscode.TestController,
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
) {
  if (
    vscode.workspace.workspaceFolders === undefined ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  const runner = new TestRunner(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
    getVitestCommand(vscode.workspace.workspaceFolders[0].uri.fsPath),
  );

  const tests = request.include ?? gatherTestItems(ctrl.items);
  const run = ctrl.createTestRun(request);
  await runTest(ctrl, runner, run, tests, "run");
  run.end();
}

export async function updateSnapshot(
  ctrl: vscode.TestController,
  test: vscode.TestItem,
) {
  if (
    vscode.workspace.workspaceFolders === undefined ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  test = testItemIdMap.get(ctrl)!.get(test.id)!;
  const runner = new TestRunner(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
    getVitestCommand(vscode.workspace.workspaceFolders[0].uri.fsPath),
  );

  const request = new vscode.TestRunRequest([test]);
  const tests = [test];
  const run = ctrl.createTestRun(request);
  run.started(test);
  await runTest(ctrl, runner, run, tests, "update");
  run.end();
}

export async function debugHandler(
  ctrl: vscode.TestController,
  request: vscode.TestRunRequest,
) {
  if (
    vscode.workspace.workspaceFolders === undefined ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  const tests = request.include ?? gatherTestItems(ctrl.items);
  const run = ctrl.createTestRun(request);
  await runTest(ctrl, undefined, run, tests, "debug");
  run.end();
}

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}

type Mode = "debug" | "run" | "update";
async function runTest(
  ctrl: vscode.TestController,
  runner: TestRunner | undefined,
  run: vscode.TestRun,
  items: readonly vscode.TestItem[],
  mode: Mode,
) {
  if (mode !== "debug" && runner === undefined) {
    throw new Error("should provide runner if not debug");
  }

  const config = getConfig();
  const testCaseSet: Set<vscode.TestItem> = new Set();
  const testItemIdMap = new Map<string, vscode.TestItem>();
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
    for (const testCase of fileTestCases) {
      // remove suffix of test item id
      // e.g. "test-case@1" -> "test-case"
      // TODO: refactor
      testItemIdMap.set(testCase.id.replace(/@\d+$/g, ""), testCase);
    }

    for (const test of getAllTestCases(item)) {
      testCaseSet.add(test);
    }
  }

  testCaseSet.forEach((testCase) => {
    run.started(testCase);
  });

  const pathToFile = new Map<string, vscode.TestItem>();
  for (const file of fileItems) {
    pathToFile.set(sanitizeFilePath(file.uri!.fsPath), file);
  }

  let out;

  try {
    if (mode === "debug") {
      out = await debugTest(vscode.workspace.workspaceFolders![0], run, items);
    } else {
      let command = undefined;
      if (config.commandLine) {
        const commandLine = config.commandLine.trim();
        command = {
          cmd: commandLine.split(" ")[0],
          args: commandLine.split(" ").slice(1),
        };
      }

      out = await runner!.scheduleRun(
        fileItems.map((x) => x.uri!.fsPath),
        items.length === 1
          ? WEAKMAP_TEST_DATA.get(items[0])!.getFullPattern()
          : "",
        items.length === 1
          ? (msg) => run.appendOutput(msg, undefined, items[0])
          : (msg) => run.appendOutput(msg),
        config.env || undefined,
        command,
        mode === "update",
      );
    }
  } catch (e) {
    console.error(e);
    run.appendOutput("Run test failed \r\n" + (e as Error) + "\r\n");
    run.appendOutput("" + (e as Error)?.stack + "\r\n");
    testCaseSet.forEach((testCase) => {
      run.errored(testCase, new vscode.TestMessage((e as Error)?.toString()));
    });
    testCaseSet.clear();
  }

  if (out === undefined) {
    testCaseSet.forEach((testCase) => {
      run.errored(testCase, new vscode.TestMessage("Internal Error"));
    });
    return;
  }

  if (out.testResults.length !== 0) {
    out.testResults.forEach(
      (fileResult) => {
        fileResult.assertionResults.forEach((result, index) => {
          const id = getTestCaseId(
            pathToFile.get(sanitizeFilePath(fileResult.name))!,
            result.fullName.trim(),
          ) || "";
          const child = testItemIdMap.get(id)!;
          if (!child || !testCaseSet.has(child)) {
            return;
          }

          testCaseSet.delete(child);
          switch (result.status) {
            case "passed":
              run.passed(child, result.duration ?? undefined);
              return;
            case "failed":
              run.failed(
                child,
                new vscode.TestMessage(result.failureMessages.join("\r\n")),
              );
              return;
          }

          if (result.status === "skipped" || result.status == null) {
            run.skipped(child);
          }
        });
      },
    );

    testCaseSet.forEach((testCase) => {
      run.errored(
        testCase,
        new vscode.TestMessage(
          `Test result not found. \r\n` +
            `Can you run vitest successfully on this file? Does it need custom option to run?`,
        ),
      );
      run.appendOutput(`Cannot find test ${testCase.id}`);
    });
  } else {
    testCaseSet.forEach((testCase) => {
      run.errored(
        testCase,
        new vscode.TestMessage(
          "Unexpected condition. Please report the bug to https://github.com/vitest-dev/vscode/issues",
        ),
      );
    });
  }
}

async function debugTest(
  workspaceFolder: vscode.WorkspaceFolder,
  run: vscode.TestRun,
  testItems: readonly vscode.TestItem[],
) {
  let config = {
    type: "pwa-node",
    request: "launch",
    name: "Debug Current Test File",
    autoAttachChildProcesses: true,
    skipFiles: ["<node_internals>/**", "**/node_modules/**"],
    program: getVitestPath(workspaceFolder.uri.fsPath),
    args: [] as string[],
    smartStep: true,
  };

  const outputFilePath = getTempPath();
  const testData = testItems.map((item) => WEAKMAP_TEST_DATA.get(item)!);
  config.args = [
    "run",
    ...new Set(
      testData.map((x) =>
        relative(workspaceFolder.uri.fsPath, x.getFilePath()).replace(
          /\\/g,
          "/",
        )
      ),
    ),
    testData.length === 1 ? "--testNamePattern" : "",
    testData.length === 1 ? testData[0].getFullPattern() : "",
    "--reporter=default",
    "--reporter=json",
    "--outputFile",
    outputFilePath,
  ];

  if (config.program == null) {
    vscode.window.showErrorMessage("Cannot find vitest");
    return;
  }

  return new Promise<FormattedTestResults>((resolve, reject) => {
    vscode.debug.startDebugging(workspaceFolder, config).then(
      () => {
        vscode.debug.onDidChangeActiveDebugSession((e) => {
          if (!e) {
            console.log("DISCONNECTED");
            setTimeout(async () => {
              if (!existsSync(outputFilePath)) {
                const prefix = `When running:\r\n` +
                  `    node ${
                    config.program + " " + config.args.join(" ")
                  }\r\n` +
                  `cwd: ${workspaceFolder.uri.fsPath}\r\n` +
                  `node: ${await getNodeVersion()}` +
                  `env.PATH: ${process.env.PATH}`;
                reject(new Error(prefix));
                return;
              }

              const file = await readFile(outputFilePath, "utf-8");
              const out = JSON.parse(file) as FormattedTestResults;
              resolve(out);
            });
          }
        });
      },
      (err) => {
        console.error(err);
        console.log("START DEBUGGING FAILED");
        reject();
      },
    );
  });
}
