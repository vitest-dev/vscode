import * as vscode from "vscode";
import { discoverTestFromFileContent } from "./discover";
import { getContentFromFilesystem } from "./vscode_utils";

export const testData = new WeakMap<vscode.TestItem, TestData>();

export type TestData = TestFile | TestDescribe | TestCase;

export class TestFile {
  resolved = false;
  public async updateFromDisk(
    controller: vscode.TestController,
    item: vscode.TestItem
  ) {
    try {
      const content = await getContentFromFilesystem(item.uri!);
      item.error = undefined;
      discoverTestFromFileContent(controller, content, item);
    } catch (e) {
      item.error = (e as Error).stack;
    }
  }
}
export class TestDescribe {}
export class TestCase {}
