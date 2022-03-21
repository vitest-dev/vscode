import * as vscode from "vscode";
import {
  TestFile,
  TestData,
  WEAKMAP_TEST_DATA,
  TestDescribe,
  TestCase,
  testItemIdMap,
} from "./test_data";
import parse from "./pure/parsers";
import { NamedBlock } from "./pure/parsers/parser_nodes";

export function discoverTestFromDoc(
  ctrl: vscode.TestController,
  e: vscode.TextDocument
) {
  if (e.uri.scheme !== "file") {
    return;
  }

  if (!e.uri.path.match(/\.[tj]sx?$/)) {
    return;
  }

  const { file, data } = getOrCreateFile(ctrl, e.uri);
  discoverTestFromFileContent(ctrl, e.getText(), file, data);
}

function getOrCreateFile(controller: vscode.TestController, uri: vscode.Uri) {
  const existing = controller.items.get(uri.toString());
  if (existing) {
    return {
      file: existing,
      data: WEAKMAP_TEST_DATA.get(existing) as TestFile,
    };
  }

  const file = controller.createTestItem(
    uri.toString(),
    uri.path.split("/").pop()!,
    uri
  );
  controller.items.add(file);

  const data = new TestFile();
  WEAKMAP_TEST_DATA.set(file, data);

  file.canResolveChildren = true;
  return { file, data };
}

export function discoverTestFromFileContent(
  controller: vscode.TestController,
  content: string,
  item: vscode.TestItem,
  data: TestFile
) {
  if (testItemIdMap.get(controller) == null) {
    testItemIdMap.set(controller, new Map());
  }

  const idMap = testItemIdMap.get(controller)!;
  const ancestors = [
    {
      item,
      block: undefined as NamedBlock | undefined,
      children: [] as vscode.TestItem[],
      data: data as TestData,
    },
  ];

  function getParent(block: NamedBlock): typeof ancestors[number] {
    let parent = ancestors[ancestors.length - 1];
    if (parent.block == null) {
      return parent;
    }

    while (parent.block && block.start!.line >= parent.block.end!.line) {
      const top = ancestors.pop();
      if (top) {
        top.item.children.replace(top.children);
      }

      parent = ancestors[ancestors.length - 1];
    }

    return parent;
  }

  let result: ReturnType<typeof parse>;
  try {
    result = parse(item.id, content);
  } catch (e) {
    console.log("parse error");
    return;
  }

  const arr: NamedBlock[] = [...result.describeBlocks, ...result.itBlocks];
  arr.sort((a, b) => (a.start?.line || 0) - (b.start?.line || 0));
  let testCaseIndex = 0;
  let index = 0;
  for (const block of arr) {
    const parent = getParent(block);
    const id = `${item.uri}/${block.name}@${index++}`;
    const caseItem = controller.createTestItem(id, block.name!, item.uri);
    idMap.set(id, caseItem);
    caseItem.range = new vscode.Range(
      new vscode.Position(block.start!.line - 1, block.start!.column),
      new vscode.Position(block.end!.line - 1, block.end!.column)
    );
    parent.children.push(caseItem);
    if (block.type === "describe") {
      const data = new TestDescribe(block.name!, item, parent.data as TestFile);
      WEAKMAP_TEST_DATA.set(caseItem, data);
      ancestors.push({ item: caseItem, block, children: [], data });
    } else if (block.type === "it") {
      const testCase = new TestCase(
        block.name!,
        item,
        parent.data as TestFile | TestDescribe,
        testCaseIndex++
      );
      WEAKMAP_TEST_DATA.set(caseItem, testCase);
    } else {
      throw new Error();
    }
  }

  while (ancestors.length) {
    const top = ancestors.pop();
    if (top) {
      top.item.children.replace(top.children);
    }
  }
}

export async function discoverAllFilesInWorkspace(
  controller: vscode.TestController
) {
  if (!vscode.workspace.workspaceFolders) {
    return []; // handle the case of no open folders
  }

  return Promise.all(
    vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
      const pattern = new vscode.RelativePattern(
        workspaceFolder,
        "**/*.test.ts"
      );
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      // When files are created, make sure there's a corresponding "file" node in the tree
      watcher.onDidCreate((uri) => getOrCreateFile(controller, uri));
      // When files change, re-parse them. Note that you could optimize this so
      // that you only re-parse children that have been resolved in the past.
      watcher.onDidChange((uri) => {
        const { data, file } = getOrCreateFile(controller, uri);
        data.updateFromDisk(controller, file);
      });
      // And, finally, delete TestItems for removed files. This is simple, since
      // we use the URI as the TestItem's ID.
      watcher.onDidDelete((uri) => controller.items.delete(uri.toString()));

      for (const file of await vscode.workspace.findFiles(pattern)) {
        getOrCreateFile(controller, file);
      }

      return watcher;
    })
  );
}
