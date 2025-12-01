import * as vscode from 'vscode'

export class SchemaProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private disposables: vscode.Disposable[] = []

  private _onDidChangeEvents = new vscode.EventEmitter<vscode.Uri>()

  constructor(
    private getTransformedModule: (apiId: string, project: string, environment: string, file: string) => Promise<string | null>,
  ) {
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider('vitest-transform', this))
    this.disposables.push(this._onDidChangeEvents)
  }

  public onDidChange = this._onDidChangeEvents.event

  public emitChange(uri: vscode.Uri) {
    const cachedFsPaths = this._cachedFsPaths.get(uri.fsPath)
    if (cachedFsPaths) {
      cachedFsPaths.forEach((uri) => {
        this._onDidChangeEvents.fire(uri)
      })
    }
  }

  private _cachedFsPaths = new Map<string, Set<vscode.Uri>>()

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const searchParams = new URLSearchParams(uri.query)
    const apiId = searchParams.get('apiId')
    const project = searchParams.get('project')
    const environment = searchParams.get('environment')
    if (apiId == null || project == null || environment == null) {
      throw new Error(`Cannot parse the schema: ${uri.toString()}`)
    }
    const fsPath = uri.fsPath.slice(0, -3) // remove .js

    let _cachedUris = this._cachedFsPaths.get(fsPath)
    if (!_cachedUris) {
      _cachedUris = new Set()
    }
    else {
      // remove older files from the same environment
      _cachedUris.forEach((uri) => {
        const query = uri.query.replace(/&t=\d+/, '')
        const currentQuery = uri.query.replace(/&t=\d+/, '')
        if (query === currentQuery) {
          _cachedUris?.delete(uri)
        }
      })
    }
    _cachedUris.add(uri)
    this._cachedFsPaths.set(fsPath, _cachedUris)

    const content = await this.getTransformedModule(apiId, project, environment, fsPath)
    if (content == null) {
      throw new Error(`The file ${fsPath} was not processed by Vite yet.`)
    }
    return content
  }

  dispose() {
    this._cachedFsPaths.clear()
    this.disposables.forEach(d => d.dispose())
  }
}
