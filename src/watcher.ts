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
      this.reset()
      log.verbose?.('[VSCODE] Watcher disposed')
    })
  }

  reset() {
    this.watcherByFolder.forEach(x => x.dispose())
    this.watcherByFolder.clear()
  }

  watchTestFilesInWorkspace(api: VitestFolderAPI) {
    if (this.watcherByFolder.has(api.workspaceFolder)) {
      return
    }

    const pattern = new vscode.RelativePattern(api.workspaceFolder, getConfig(api.workspaceFolder).filesWatcherInclude)
    log.info('[VSCODE] Watching', api.workspaceFolder.name, 'with pattern', pattern.pattern)
    const watcher = vscode.workspace.createFileSystemWatcher(
      pattern,
    )
    this.watcherByFolder.set(api.workspaceFolder, watcher)

    watcher.onDidDelete((uri) => {
      log.verbose?.('[VSCODE] File deleted:', relative(api.workspaceFolder.uri.fsPath, uri.fsPath))
      this.testTree.removeFile(normalize(uri.fsPath))
    })

    watcher.onDidChange(async (uri) => {
      const filepath = normalize(uri.fsPath)
      if (await this.shouldIgnoreFile(filepath, uri)) {
        return
      }
      log.verbose?.('[VSCODE] File changed:', relative(api.workspaceFolder.uri.fsPath, uri.fsPath))
      api.onFileChanged(filepath)
    })

    watcher.onDidCreate(async (uri) => {
      const filepath = normalize(uri.fsPath)
      if (await this.shouldIgnoreFile(filepath, uri)) {
        return
      }
      log.verbose?.('[VSCODE] File created:', relative(api.workspaceFolder.uri.fsPath, uri.fsPath))
      api.onFileCreated(filepath)
    })
  }

  private async shouldIgnoreFile(path: string, uri: vscode.Uri) {
    if (
      path.includes('/node_modules/')
      || path.includes('/.git/')
      || path.endsWith('.git')
    ) {
      log.verbose?.('[VSCODE] Ignoring file:', uri.fsPath)
      return true
    }
    try {
      const stats = await vscode.workspace.fs.stat(uri)
      if (
        // if not a file
        stats.type !== vscode.FileType.File
        // if not a symlinked file
        && stats.type !== (vscode.FileType.File | vscode.FileType.SymbolicLink)
      ) {
        log.verbose?.('[VSCODE]', uri.fsPath, 'is not a file. Ignoring.')
        return true
      }
      return false
    }
    catch (err: unknown) {
      log.verbose?.('[VSCODE] Error checking file stats:', uri.fsPath, err as string)
      return true
    }
  }
}
