import { debounce } from "mighty-promise";
import * as vscode from "vscode";
import { extensionId } from "./config";
import { TestFileDiscoverer } from "./discover";
import { isVitestEnv } from "./pure/isVitestEnv";
import { debugHandler, runHandler } from "./runHandler";
import { WEAKMAP_TEST_DATA, TestFile } from "./TestData";

export async function activate(context: vscode.ExtensionContext) {
  if (
    vscode.workspace.workspaceFolders == null ||
    vscode.workspace.workspaceFolders.length === 0 ||
    !(await isVitestEnv(vscode.workspace.workspaceFolders[0].uri.path))
  ) {
    return;
  }

  const ctrl = vscode.tests.createTestController(
    `${extensionId}`,
    "Vitest Test Provider"
  );

  const fileDiscoverer = new TestFileDiscoverer();
  ctrl.refreshHandler = async () => {
    // TODO: should delete redundant tests here
    context.subscriptions.push(
      ...(await fileDiscoverer.discoverAllFilesInWorkspace(ctrl))
    );
  };

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      context.subscriptions.push(
        ...(await fileDiscoverer.discoverAllFilesInWorkspace(ctrl))
      );
    } else {
      const data = WEAKMAP_TEST_DATA.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(ctrl);
      }
    }
  };

  ctrl.createRunProfile(
    "Run Tests",
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl),
    true
  );

  ctrl.createRunProfile(
    "Debug Tests",
    vscode.TestRunProfileKind.Debug,
    debugHandler.bind(null, ctrl),
    true
  );

  vscode.window.visibleTextEditors.forEach((x) =>
    fileDiscoverer.discoverTestFromDoc(ctrl, x.document)
  );

  context.subscriptions.push(
    ctrl,
    // TODO
    // vscode.commands.registerCommand("vitest-explorer.configureTest", () => {
    //   vscode.window.showInformationMessage("Not implemented");
    // }),
    vscode.workspace.onDidOpenTextDocument((e) => {
      fileDiscoverer.discoverTestFromDoc(ctrl, e);
    }),
    vscode.workspace.onDidChangeTextDocument(
      debounce(
        (e) => fileDiscoverer.discoverTestFromDoc(ctrl, e.document),
        1000
      )
    )
  );
}

export function deactivate() {}
