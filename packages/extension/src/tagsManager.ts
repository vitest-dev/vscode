import * as vscode from 'vscode'

export class TagsManager {
  private userTags = new Map<string, vscode.TestTag>()

  getTestTag(name: string) {
    if (!this.userTags.has(name)) {
      this.userTags.set(name, new vscode.TestTag(name))
    }
    return this.userTags.get(name)!
  }
}
