import type { VitestProcessAPI } from './apiProcess'
import type { TransformSchemaProvider } from './schemaProvider'
import type { TestTree } from './testTree'
import { relative } from 'node:path'
import { normalize, resolve } from 'pathe'
import * as vscode from 'vscode'
import { getConfig } from './config'
import { log } from './log'

const DEBOUNCE_DELAY = 300

export class ExtensionWatcher extends vscode.Disposable {
  private watcherByFolder = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()
  private apisByFolder = new WeakMap<vscode.WorkspaceFolder, VitestProcessAPI[]>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
    this.debounceTimers.forEach((timer) => clearTimeout(timer))
    this.debounceTimers.clear()
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

    const deleteQueue = new Map<string, vscode.Uri>()
    const changeQueue = new Map<string, vscode.Uri>()
    const createQueue = new Map<string, vscode.Uri>()

    watcher.onDidDelete((uri) => {
      const path = normalize(uri.fsPath)
      if (this.isCommondIgnore(path)) {
        return
      }
      deleteQueue.set(path, uri)
      this.scheduleFlush(`delete:${folder.name}`, () => {
        const batch = new Map(deleteQueue)
        deleteQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} deleted items`)
        for (const [path, uri] of batch) {
          this.transformSchemaProvider.emitChange(uri)
          // We don't know if it is a file or a folder
          this.testTree.removeFile(path)
          this.testTree.removeFolder(path)
        }
      })
    })

    watcher.onDidChange((uri) => {
      const path = normalize(uri.fsPath)
      if (this.isCommondIgnore(path)) {
        return
      }
      changeQueue.set(path, uri)
      this.scheduleFlush(`change:${folder.name}`, async () => {
        const batch = new Map(changeQueue)
        changeQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} changed items`)
        const apis = this.apisByFolder.get(folder) || []
        for (const [path, uri] of batch) {
          const type = await this.getFsType(api, path, uri)
          if (type !== 'file') {
            continue
          }
          this.transformSchemaProvider.emitChange(uri)

          apis.forEach((api) => {
            api.onFileChanged(path)
            const fileItems = this.testTree.getFileTestItems(path)

            // Ignore changed to never opened files
            if (fileItems.every((item) => item.children.size === 0 && !item.error)) {
              return
            }

            if (api.getPersistentProcessMeta() || api.isSpawningPersistentProcess) {
              return
            }

            const metadata = api.getPotentialTestFileMetadata(path)
            metadata.forEach((meta) => {
              api.collectTests(meta.project, path)
            })
          })
        }
      })
    })

    watcher.onDidCreate((uri) => {
      const path = normalize(uri.fsPath)
      if (this.isCommondIgnore(path)) {
        return
      }
      createQueue.set(path, uri)
      this.scheduleFlush(`create:${folder.name}`, async () => {
        const batch = new Map(createQueue)
        createQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} created items`)

        const apis = this.apisByFolder.get(folder) || []
        const roots = apis.flatMap((api) =>
          // TODO: resolve should be done on the worker side
          api.config.projects.map((p) => normalize(resolve(api.config.cwd, p.dir || p.root))),
        )
        const openedFiles = vscode.workspace.textDocuments.map((d) => normalize(d.uri.fsPath))

        const allFiles: string[] = []
        for (const [path, uri] of batch) {
          const type = await this.getFsType(api, path, uri)
          if (!type) {
            continue
          }
          if (type === 'file') {
            allFiles.push(path)
          } else {
            allFiles.push(...(await this.readFilesRecursively(uri, roots)))
          }
        }

        allFiles.forEach((file) => {
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
    })
  }

  private scheduleFlush(key: string, flush: () => void) {
    const existing = this.debounceTimers.get(key)
    if (existing) {
      clearTimeout(existing)
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key)
        flush()
      }, DEBOUNCE_DELAY),
    )
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
