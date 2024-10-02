import { stat } from 'node:fs/promises'
import { relative } from 'node:path'
import * as vscode from 'vscode'
import { normalize } from 'pathe'
import mm from 'micromatch'
import type { TestTree } from './testTree'
import { getConfig } from './config'
import type { VitestFolderAPI } from './api'
import { log } from './log'

export class ExtensionWatcher extends vscode.Disposable {
  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()

  private readonly ignorePattern = [
    '**/.git/**',
    '**/*.git',
  ]

  constructor(private readonly testTree: TestTree) {
    super(() => {
      this.watcherByFolder.forEach(x => x.dispose())
      this.watcherByFolder.clear()
    })
  }

  async watchTestFilesInWorkspace(api: VitestFolderAPI) {
    if (this.watcherByFolder.has(api.workspaceFolder))
      return

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(api.workspaceFolder, getConfig(api.workspaceFolder).filesWatcherInclude),
    )
    this.watcherByFolder.set(api.workspaceFolder, watcher)

    watcher.onDidDelete((file) => {
      log.verbose?.('[VSCODE] File deleted:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      this.testTree.removeFile(normalize(file.fsPath))
    })

    watcher.onDidChange(async (file) => {
      const filepath = normalize(file.fsPath)
      if (await this.shouldIgnoreFile(filepath)) {
        return
      }
      log.verbose?.('[VSCODE] File changed:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      api.onFileChanged(filepath)
    })

    watcher.onDidCreate(async (file) => {
      const filepath = normalize(file.fsPath)
      if (await this.shouldIgnoreFile(filepath)) {
        return
      }
      log.verbose?.('[VSCODE] File created:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      api.onFileCreated(filepath)
    })
  }

  private async shouldIgnoreFile(filepath: string) {
    const stats = await stat(filepath).catch(() => null)
    return !stats || stats.isDirectory() || mm.isMatch(filepath, this.ignorePattern)
  }
}
