import { debounce } from "mighty-promise";
import * as vscode from "vscode";
import { extensionId } from "./config";
import { discoverAllFilesInWorkspace, discoverTestFromDoc } from "./discover";
import { getVitePath as getVitestPath, TestRunner } from "./pure/runner";
import { runTest } from "./run_test";
import { WEAKMAP_TEST_DATA, TestFile } from "./test_data";

export function activate(context: vscode.ExtensionContext) {
  const ctrl = vscode.tests.createTestController(
    `${extensionId}`,
    "Vitest Test Provider"
  );
  ctrl.refreshHandler = async () => {
    await discoverAllFilesInWorkspace(ctrl);
  };

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      await discoverAllFilesInWorkspace(ctrl);
    } else {
      const data = WEAKMAP_TEST_DATA.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(ctrl, item);
      }
    }
  };

  ctrl.createRunProfile(
    "Run Tests",
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl),
    true
  );

  vscode.window.visibleTextEditors.forEach((x) =>
    discoverTestFromDoc(ctrl, x.document)
  );

  context.subscriptions.push(
    ctrl,
    vscode.commands.registerCommand("vitest-explorer.configureTest", () => {
      vscode.window.showInformationMessage("Not implemented");
    }),
    vscode.workspace.onDidOpenTextDocument((e) => {
      discoverTestFromDoc(ctrl, e);
    }),
    vscode.workspace.onDidChangeTextDocument(
      debounce((e) => discoverTestFromDoc(ctrl, e.document), 1000)
    )
  );
}

export function deactivate() {}

async function runHandler(
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
  await Promise.all(tests.map((test) => runTest(runner, run, test)));
}

function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}
