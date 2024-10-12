import { relative } from 'node:path'
import * as vscode from 'vscode'
import { normalize } from 'pathe'
import type { TestTree } from './testTree'
import { getConfig } from './config'
import type { VitestFolderAPI } from './api'
import { log } from './log'

export class ExtensionWatcher extends vscode.Disposable {
  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()

  constructor(private readonly testTree: TestTree) {
    super(() => {
      this.watcherByFolder.forEach(x => x.dispose())
      this.watcherByFolder.clear()
    })
  }

  watchTestFilesInWorkspace(api: VitestFolderAPI) {
    if (this.watcherByFolder.has(api.workspaceFolder))
      return

    const pattern = getConfig(api.workspaceFolder).filesWatcherInclude
    log.info('[VSCODE] Watching', api.workspaceFolder.name, 'with pattern', pattern)
    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
    )
    this.watcherByFolder.set(api.workspaceFolder, watcher)

    watcher.onDidDelete((file) => {
      log.verbose?.('[VSCODE] File deleted:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      this.testTree.removeFile(normalize(file.fsPath))
    })

    watcher.onDidChange(async (file) => {
      const filepath = normalize(file.fsPath)
      if (await this.shouldIgnoreFile(filepath, file)) {
        return
      }
      log.verbose?.('[VSCODE] File changed:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      api.onFileChanged(filepath)
    })

    watcher.onDidCreate(async (file) => {
      const filepath = normalize(file.fsPath)
      if (await this.shouldIgnoreFile(filepath, file)) {
        return
      }
      log.verbose?.('[VSCODE] File created:', relative(api.workspaceFolder.uri.fsPath, file.fsPath))
      api.onFileCreated(filepath)
    })
  }

  private async shouldIgnoreFile(filepath: string, file: vscode.Uri) {
    if (
      filepath.includes('/node_modules/')
      || filepath.includes('/.git/')
      || filepath.endsWith('.git')
    ) {
      log.verbose?.('[VSCODE] Ignoring file:', file.fsPath)
      return true
    }
    try {
      const stats = await vscode.workspace.fs.stat(file)
      if (
        // if not a file
        stats.type !== vscode.FileType.File
        // if not a symlinked file
        && stats.type !== (vscode.FileType.File | vscode.FileType.SymbolicLink)
      ) {
        log.verbose?.('[VSCODE]', file.fsPath, 'is not a file. Ignoring.')
        return true
      }
      return false
    }
    catch (err: unknown) {
      log.verbose?.('[VSCODE] Error checking file stats:', file.fsPath, err as string)
      return true
    }
  }
}
