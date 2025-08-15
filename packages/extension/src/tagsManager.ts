import type { TestTree } from './testTree'
import * as vscode from 'vscode'

export class TagsManager extends vscode.Disposable {
  private disposables: vscode.Disposable[] = []

  private openTestTag = new vscode.TestTag('open')

  constructor(
    private testTree: TestTree,
  ) {
    super(() => {
      this.disposables.forEach(d => d.dispose())
      this.disposables = []
    })
  }

  activate() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        this.addFileTag(doc.uri, this.openTestTag)
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.removeFileTag(doc.uri, this.openTestTag)
      }),
    )

    vscode.window.visibleTextEditors.forEach(({ document }) => {
      this.addFileTag(document.uri, this.openTestTag)
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

  removeFileTag(uri: vscode.Uri, tag: vscode.TestTag) {
    const fileItems = this.testTree.getFileTestItems(uri.fsPath)
    if (!fileItems)
      return
    fileItems.forEach((item) => {
      this.removeItemTag(item, tag)
    })
  }

  addFileTag(uri: vscode.Uri, tag: vscode.TestTag) {
    const fileItems = this.testTree.getFileTestItems(uri.fsPath)
    if (!fileItems)
      return
    fileItems.forEach((item) => {
      this.addItemTag(item, tag)
    })
  }
}
