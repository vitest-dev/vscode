import type { TestTree } from './testTree'
import * as vscode from 'vscode'

export class TagsManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []

  private openTestTag = new vscode.TestTag('open')
  private userTags = new Map<string, vscode.TestTag>()

  constructor() {
    super(() => {
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
    })
  }

  activate(testTree: TestTree) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.addFileTag(testTree, doc.uri, this.openTestTag)
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.removeFileTag(testTree, doc.uri, this.openTestTag)
      }),
    )

    vscode.window.visibleTextEditors.forEach(({ document }) => {
      this.addFileTag(testTree, document.uri, this.openTestTag)
    })
  }

  addItemTag(item: vscode.TestItem, tag: vscode.TestTag) {
    if (!item.tags.includes(tag))
      item.tags = [...item.tags, tag]
    item.children.forEach((child) => {
      this.addItemTag(child, tag)
    })
  }

  removeItemTag(item: vscode.TestItem, tag: vscode.TestTag) {
    item.tags = item.tags.filter(x => x !== tag)
    item.children.forEach((child) => {
      this.removeItemTag(child, tag)
    })
  }

  removeFileTag(testTree: TestTree, uri: vscode.Uri, tag: vscode.TestTag) {
    const fileItems = testTree.getFileTestItems(uri.fsPath)
    if (!fileItems)
      return
    fileItems.forEach((item) => {
      this.removeItemTag(item, tag)
    })
  }

  addFileTag(testTree: TestTree, uri: vscode.Uri, tag: vscode.TestTag) {
    const fileItems = testTree.getFileTestItems(uri.fsPath)
    if (!fileItems)
      return
    fileItems.forEach((item) => {
      this.addItemTag(item, tag)
    })
  }

  getTestTag(name: string) {
    if (!this.userTags.has(name)) {
      this.userTags.set(name, new vscode.TestTag(name))
    }
    return this.userTags.get(name)!
  }
}
