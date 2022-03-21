import * as vscode from "vscode";
import { getVitestPath as getVitestPath, TestRunner } from "./pure/runner";
import { runTest } from "./runTest";

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
  await Promise.all(tests.map((test) => runTest(runner, run, test)));
}
function gatherTestItems(collection: vscode.TestItemCollection) {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => items.push(item));
  return items;
}
