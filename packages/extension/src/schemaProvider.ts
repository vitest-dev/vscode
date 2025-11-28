import * as vscode from 'vscode'

export class SchemaProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private disposables: vscode.Disposable[] = []

  constructor(
    private getTransformedModule: (apiId: string, project: string, environment: string, file: string) => Promise<string | null>,
  ) {
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider('vitest-transform', this))
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const searchParams = new URLSearchParams(uri.query)
    const apiId = searchParams.get('apiId')
    const project = searchParams.get('project')
    const environment = searchParams.get('environment')
    if (apiId == null || project == null || environment == null) {
      throw new Error(`Cannot parse the schema: ${uri.toString()}`)
    }
    const fsPath = uri.fsPath.slice(0, -3) // remove .js
    const content = await this.getTransformedModule(apiId, project, environment, fsPath)
    if (content == null) {
      throw new Error(`The file ${fsPath} was not processed by Vite yet.`)
    }
    return content
  }

  dispose() {
    this.disposables.forEach(d => d.dispose())
  }
}
