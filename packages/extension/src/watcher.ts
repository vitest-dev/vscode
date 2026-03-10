import type { VitestProcessAPI } from './apiProcess'
import type { TransformSchemaProvider } from './schemaProvider'
import type { TestTree } from './testTree'
import { relative } from 'node:path'
import { normalize, resolve } from 'pathe'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { log } from './log'

export class ExtensionWatcher extends vscode.Disposable {
  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()
  private apisByFolder = new WeakMap<vscode.WorkspaceFolder, VitestProcessAPI[]>()

  constructor(
    private readonly testTree: TestTree,
    private readonly transformSchemaProvider: TransformSchemaProvider,
  ) {
    super(() => {
      this.reset()
      log.verbose?.('[VSCODE] Watcher disposed')
    })
  }

  reset() {
    this.watcherByFolder.forEach((x) => x.dispose())
    this.watcherByFolder.clear()
    this.apisByFolder = new WeakMap()
  }

  watchTestFilesInWorkspace(api: VitestProcessAPI) {
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

    watcher.onDidDelete(async (uri) => {
      const path = normalize(uri.fsPath)
      if (this.isCommondIgnore(path)) {
        return
      }

      log.verbose?.('[VSCODE] Item deleted:', this.relative(api, uri))

      this.transformSchemaProvider.emitChange(uri)

      // We don't know if it is a file or a folder
      this.testTree.removeFile(path)
      this.testTree.removeFolder(path)
    })

    watcher.onDidChange(async (uri) => {
      const path = normalize(uri.fsPath)
      const type = await this.getFsType(api, path, uri)
      if (type !== 'file') {
        return
      }

      this.transformSchemaProvider.emitChange(uri)
      log.verbose?.('[VSCODE] File changed:', this.relative(api, uri))
      const apis = this.apisByFolder.get(folder) || []
      apis.forEach((api) => api.onFileChanged(path))
      apis.forEach((api) => {
        if (api.getPersistentProcessMeta() || api.isSpawningPersistentProcess) {
          return
        }
        const metadata = api.getPotentialTestFileMetadata(path)
        metadata.forEach((meta) => {
          api.collectTests(meta.project, path)
        })
      })
    })

    watcher.onDidCreate(async (uri) => {
      const path = normalize(uri.fsPath)
      const type = await this.getFsType(api, path, uri)

      if (!type) {
        return
      }

      log.verbose?.('[VSCODE]', 'New', type, 'created:', this.relative(api, uri))

      const apis = this.apisByFolder.get(folder) || []
      const roots = apis.flatMap((api) =>
        // TODO: resolve should be done on the worker side
        api.config.projects.map((p) => normalize(resolve(api.config.cwd, p.dir || p.root))),
      )
      const files = type === 'file' ? [path] : await this.readFilesRecursively(uri, roots)
      const openedFiles = vscode.workspace.textDocuments.map((d) => normalize(d.uri.fsPath))

      files.forEach((file) => {
        apis.forEach((api) => {
          const metadata = api.getPotentialTestFileMetadata(file)
          metadata.forEach((meta) => {
            this.testTree.getOrCreateFileTestItem(api, meta, file)

            // If file is open and not a continuous run,
            // Collect its tests immidetly, otherwise ignore
            if (
              openedFiles.includes(file) &&
              !api.getPersistentProcessMeta() &&
              !api.isSpawningPersistentProcess
            ) {
              api.collectTests(meta.project, file)
            }
          })
        })
      })
    })
  }

  private relative(api: VitestProcessAPI, uri: vscode.Uri) {
    return relative(api.workspaceFolder.uri.fsPath, uri.fsPath)
  }

  private isCommondIgnore(path: string) {
    return (
      path.includes('/node_modules/') ||
      path.includes('\\node_modules\\') ||
      path.includes('/.git/') ||
      path.includes('\\.git\\') ||
      path.endsWith('.git')
    )
  }

  private async readFilesRecursively(uri: vscode.Uri, roots: string[]): Promise<string[]> {
    const dirPath = normalize(uri.fsPath)
    // skip if this directory is not inside any project root and no root is inside it
    if (!roots.some((root) => dirPath.startsWith(root) || root.startsWith(dirPath))) {
      return []
    }
    const entries = await vscode.workspace.fs.readDirectory(uri)
    const files: string[] = []
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(uri, name)
      if (
        type === vscode.FileType.Directory ||
        type === (vscode.FileType.Directory | vscode.FileType.SymbolicLink)
      ) {
        if (this.isCommondIgnore(normalize(childUri.fsPath))) {
          continue
        }
        files.push(...(await this.readFilesRecursively(childUri, roots)))
      } else if (
        type === vscode.FileType.File ||
        type === (vscode.FileType.File | vscode.FileType.SymbolicLink)
      ) {
        files.push(normalize(childUri.fsPath))
      }
    }
    return files
  }

  private async getFsType(api: VitestProcessAPI, path: string, uri: vscode.Uri) {
    if (this.isCommondIgnore(path)) {
      return null
    }
    try {
      const stats = await vscode.workspace.fs.stat(uri)
      if (
        // if not a file
        stats.type !== vscode.FileType.File &&
        // if not a symlinked file
        stats.type !== (vscode.FileType.File | vscode.FileType.SymbolicLink)
      ) {
        return 'folder'
      }
      return 'file'
    } catch {
      return null
    }
  }
}
