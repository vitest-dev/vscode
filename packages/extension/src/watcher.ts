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
      this.scheduleFlush(`delete:${folder.index}`, () => {
        const batch = new Map(deleteQueue)
        deleteQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} deleted items`)
        for (const [path, uri] of batch) {
          this.transformSchemaProvider.emitChange(uri)
          // We don't know if it was a file or a folder
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
      this.scheduleFlush(`change:${folder.index}`, async () => {
        const batch = new Map(changeQueue)
        changeQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} changed items`)
        const apis = this.apisByFolder.get(folder) || []

        const entries = [...batch.entries()]
        const types = await Promise.allSettled(
          entries.map(([path, uri]) => this.getFsType(path, uri)),
        )

        for (let i = 0; i < entries.length; i++) {
          const result = types[i]
          if (result.status !== 'fulfilled' || result.value !== 'file') {
            continue
          }
          const [path, uri] = entries[i]
          this.transformSchemaProvider.emitChange(uri)

          apis.forEach((api) => {
            api.onFileChanged(path)
            const fileItems = this.testTree.getFileTestItems(path)

            // Ignore changed to never opened files
            if (fileItems.every((item) => item.children.size === 0 && !item.error)) {
              return
            }

            // If runner is persistent, the tests will be collected at runtime
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
      this.scheduleFlush(`create:${folder.index}`, async () => {
        const batch = new Map(createQueue)
        createQueue.clear()
        log.verbose?.(`[VSCODE] Flushing ${batch.size} created items`)

        const apis = this.apisByFolder.get(folder) || []
        const roots = apis.flatMap((api) =>
          api.config.projects.map((p) => normalize(p.dir || p.root)),
        )
        const openedFiles = vscode.workspace.textDocuments.map((d) => normalize(d.uri.fsPath))

        const entries = [...batch.entries()]
        const types = await Promise.allSettled(
          entries.map(([path, uri]) => this.getFsType(path, uri)),
        )

        const files: string[] = []
        const folders: [string, vscode.Uri][] = []
        for (let i = 0; i < entries.length; i++) {
          const result = types[i]
          if (result.status !== 'fulfilled' || !result.value) {
            continue
          }
          if (result.value === 'file') {
            files.push(entries[i][0])
          } else {
            folders.push(entries[i])
          }
        }

        const folderFiles = await Promise.allSettled(
          folders.map(([, uri]) => this.readFilesRecursively(uri, roots)),
        )

        const seen = new Set(files)
        for (const result of folderFiles) {
          if (result.status !== 'fulfilled') {
            continue
          }
          for (const file of result.value) {
            seen.add(file)
          }
        }

        seen.forEach((file) => {
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
    const subdirs: vscode.Uri[] = []
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(uri, name)
      if (
        type === vscode.FileType.Directory ||
        type === (vscode.FileType.Directory | vscode.FileType.SymbolicLink)
      ) {
        if (this.isCommondIgnore(normalize(childUri.fsPath))) {
          continue
        }
        subdirs.push(childUri)
      } else if (
        type === vscode.FileType.File ||
        type === (vscode.FileType.File | vscode.FileType.SymbolicLink)
      ) {
        files.push(normalize(childUri.fsPath))
      }
    }
    const results = await Promise.allSettled(
      subdirs.map((child) => this.readFilesRecursively(child, roots)),
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        files.push(...result.value)
      }
    }
    return files
  }

  private async getFsType(path: string, uri: vscode.Uri) {
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
