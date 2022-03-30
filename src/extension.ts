import { debounce } from "mighty-promise";
import * as vscode from "vscode";
import { extensionId, getConfig } from "./config";
import { TestFileDiscoverer } from "./discover";
import { isVitestEnv } from "./pure/isVitestEnv";
import { getVitestPath, getVitestVersion } from "./pure/utils";
import { debugHandler, runHandler } from "./runHandler";
import { TestFile, WEAKMAP_TEST_DATA } from "./TestData";
import semver from "semver";

export async function activate(context: vscode.ExtensionContext) {
  if (
    vscode.workspace.workspaceFolders == null ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    return;
  }

  const config = getConfig();
  if (
    !config.enable &&
    !(await isVitestEnv(vscode.workspace.workspaceFolders[0].uri.fsPath))
  ) {
    return;
  }

  const ctrl = vscode.tests.createTestController(
    `${extensionId}`,
    "Vitest Test Provider",
  );

  const fileDiscoverer = new TestFileDiscoverer();
  ctrl.refreshHandler = async () => {
    // TODO: should delete redundant tests here
    context.subscriptions.push(
      ...(await fileDiscoverer.discoverAllFilesInWorkspace(ctrl)),
    );
  };

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      context.subscriptions.push(
        ...(await fileDiscoverer.discoverAllFilesInWorkspace(ctrl)),
      );
    } else {
      const data = WEAKMAP_TEST_DATA.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(ctrl);
      }
    }
  };

  const vitestPath = getVitestPath(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
  );

  const vitestVersion = await getVitestVersion(vitestPath);
  console.dir({ vitestVersion });
  if (semver.gte(vitestVersion, "0.8.0")) {
    registerRunHandler(ctrl);
  } else {
    // v0.8.0 introduce a breaking change in json format
    // https://github.com/vitest-dev/vitest/pull/1034
    // so we need to disable run & debug in version < 0.8.0
    vscode.window.showWarningMessage(
      "Because Vitest version < 0.8.0, run & debug tests from Vitest plugin disabled.\n",
    );
  }

  vscode.window.visibleTextEditors.forEach((x) =>
    fileDiscoverer.discoverTestFromDoc(ctrl, x.document)
  );

  context.subscriptions.push(
    ctrl,
    // TODO
    // vscode.commands.registerCommand("vitest-explorer.configureTest", () => {
    //   vscode.window.showInformationMessage("Not implemented");
    // }),
    fileDiscoverer,
    vscode.workspace.onDidOpenTextDocument((e) => {
      fileDiscoverer.discoverTestFromDoc(ctrl, e);
    }),
    vscode.workspace.onDidChangeTextDocument(
      debounce(
        (e) => fileDiscoverer.discoverTestFromDoc(ctrl, e.document),
        1000,
      ),
    ),
  );
}

function registerRunHandler(ctrl: vscode.TestController) {
  ctrl.createRunProfile(
    "Run Tests",
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl),
    true,
  );

  ctrl.createRunProfile(
    "Debug Tests",
    vscode.TestRunProfileKind.Debug,
    debugHandler.bind(null, ctrl),
    true,
  );
}

export function deactivate() {}
