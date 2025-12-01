import type { VitestFolderAPI } from './api'
import type { SchemaProvider } from './schemaProvider'
import type { TestTree } from './testTree'
import { relative } from 'node:path'
import { normalize } from 'pathe'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { log } from './log'

export class ExtensionWatcher extends vscode.Disposable {
  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()
  private apisByFolder = new WeakMap<vscode.WorkspaceFolder, VitestFolderAPI[]>()

  constructor(
    private readonly testTree: TestTree,
    private readonly schemaProvider: SchemaProvider,
  ) {
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
    const folder = api.workspaceFolder
    const apis = this.apisByFolder.get(folder) ?? []
    if (!apis.includes(api)) {
      log.info('[API] Watching', relative(folder.uri.fsPath, api.id))
      apis.push(api)
    }
    this.apisByFolder.set(folder, apis)
    if (this.watcherByFolder.has(folder)) {
      return
    }

    const pattern = new vscode.RelativePattern(folder, getConfig(folder).filesWatcherInclude)
    log.info('[VSCODE] Watching', folder.name, 'with pattern', pattern.pattern)
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    this.watcherByFolder.set(folder, watcher)

    watcher.onDidDelete((uri) => {
      log.verbose?.('[VSCODE] File deleted:', this.relative(api, uri))
      this.testTree.removeFile(normalize(uri.fsPath))
      this.schemaProvider.emitChange(uri)
    })

    watcher.onDidChange(async (uri) => {
      this.schemaProvider.emitChange(uri)
      const path = normalize(uri.fsPath)
      if (await this.shouldIgnoreFile(api, path, uri)) {
        return
      }
      log.verbose?.('[VSCODE] File changed:', this.relative(api, uri))
      const apis = this.apisByFolder.get(folder) || []
      apis.forEach(api => api.onFileChanged(path))
    })

    watcher.onDidCreate(async (uri) => {
      const path = normalize(uri.fsPath)
      if (await this.shouldIgnoreFile(api, path, uri)) {
        return
      }
      log.verbose?.('[VSCODE] File created:', this.relative(api, uri))
      const apis = this.apisByFolder.get(folder) || []
      apis.forEach(api => api.onFileCreated(path))
    })
  }

  private relative(api: VitestFolderAPI, uri: vscode.Uri) {
    return relative(api.workspaceFolder.uri.fsPath, uri.fsPath)
  }

  private async shouldIgnoreFile(api: VitestFolderAPI, path: string, uri: vscode.Uri) {
    if (
      path.includes('/node_modules/')
      || path.includes('/.git/')
      || path.endsWith('.git')
    ) {
      log.verbose?.('[VSCODE] Ignoring file:', this.relative(api, uri))
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
        log.verbose?.('[VSCODE]', this.relative(api, uri), 'is not a file. Ignoring.')
        return true
      }
      return false
    }
    catch (err: unknown) {
      log.verbose?.('[VSCODE] Error checking file stats:', this.relative(api, uri), err as string)
      return true
    }
  }
}
