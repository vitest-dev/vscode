import * as vscode from "vscode";
import { extensionId, getConfig } from "./config";
import { TestFileDiscoverer } from "./discover";
import { isVitestEnv } from "./pure/isVitestEnv";
import { getVitestCommand, getVitestVersion } from "./pure/utils";
import { debugHandler, runHandler, updateSnapshot } from "./runHandler";
import { TestFile, WEAKMAP_TEST_DATA } from "./TestData";
import semver from "semver";
import { TestWatcher } from "./watch";

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

  const vitest = getVitestCommand(
    vscode.workspace.workspaceFolders[0].uri.fsPath,
  );
  const vitestVersion = await getVitestVersion(vitest);
  console.dir({ vitestVersion });
  let testWatcher: undefined | TestWatcher;
  if (vitest) {
    testWatcher = TestWatcher.create(ctrl, fileDiscoverer, vitest);
    context.subscriptions.push(
      testWatcher,
      vscode.commands.registerCommand(
        "vitest.startWatching",
        () => {
          testWatcher!.watch();
        },
      ),
    );
  }

  if (semver.gte(vitestVersion, "0.8.0")) {
    registerRunHandler(ctrl, testWatcher);
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
      (e) => fileDiscoverer.discoverTestFromDoc(ctrl, e.document),
    ),
    vscode.commands.registerCommand(
      "vitest.updateSnapshot",
      (test) => {
        updateSnapshot(ctrl, test);
      },
    ),
  );
}

function registerRunHandler(
  ctrl: vscode.TestController,
  testWatcher?: TestWatcher,
) {
  ctrl.createRunProfile(
    "Run Tests",
    vscode.TestRunProfileKind.Run,
    runHandler.bind(null, ctrl, testWatcher),
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
