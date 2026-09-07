import type * as vscode from 'vscode'

const DISABLED_CONFIGS_KEY = 'vitest.disabledConfigs'

export class ExtensionState {
  private state: vscode.Memento

  constructor(context: vscode.ExtensionContext) {
    this.state = context.workspaceState
  }

  isConfigDisabled(id: string): boolean {
    return this.state.get<string[]>(DISABLED_CONFIGS_KEY, []).includes(id)
  }

  hasDisabledConfigs(): boolean {
    return this.state.get<string[]>(DISABLED_CONFIGS_KEY, []).length > 0
  }

  setDisabledConfigs(ids: Set<string>): Thenable<void> {
    return this.state.update(DISABLED_CONFIGS_KEY, [...ids])
  }
}
