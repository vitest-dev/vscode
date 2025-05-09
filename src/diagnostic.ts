import * as vscode from 'vscode'

export class ExtensionDiagnostic {
  private diagnostic = vscode.languages.createDiagnosticCollection('Vitest')

  addDiagnostic(testFile: vscode.Uri, errors: vscode.TestMessage[]) {
    const diagnostics: vscode.Diagnostic[] = [...this.diagnostic.get(testFile) || []]
    errors.forEach((error) => {
      const range = error.location?.range
      if (!range) {
        return
      }
      const diagnostic = new vscode.Diagnostic(
        range,
        error.message.toString(),
        vscode.DiagnosticSeverity.Error,
      )
      diagnostics.push(diagnostic)
    })
    this.diagnostic.set(testFile, diagnostics)
  }

  deleteDiagnostic(testFile: vscode.Uri) {
    this.diagnostic.delete(testFile)
  }

  clearDiagnostic() {
    this.diagnostic.clear()
  }
}
