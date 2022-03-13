// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { extensionId } from "./config";
import { discoverAllFilesInWorkspace, discoverTestFromDoc } from "./discover";
import { testData, TestFile } from "./test_data";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const ctrl = vscode.tests.createTestController(
    `${extensionId}`,
    "Vitest Test Provider"
  );

  ctrl.resolveHandler = async (item) => {
    if (!item) {
      await discoverAllFilesInWorkspace(ctrl);
    } else {
      const data = testData.get(item);
      if (data instanceof TestFile) {
        await data.updateFromDisk(ctrl, item);
      }
    }
  };

  for (const document of vscode.workspace.textDocuments) {
    discoverTestFromDoc(ctrl, document);
  }

  context.subscriptions.push(
    ctrl,
    vscode.commands.registerCommand("vitest-explorer.configureTest", () => {
      vscode.window.showInformationMessage("Not implemented");
    }),
    vscode.workspace.onDidOpenTextDocument(
      discoverTestFromDoc.bind(null, ctrl)
    ),
    vscode.workspace.onDidChangeTextDocument((e) =>
      discoverTestFromDoc(ctrl, e.document)
    )
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
