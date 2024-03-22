import type * as vscode from 'vscode'

const WEAK_TEST_RUNS_DATA = new WeakMap<vscode.TestRun, TestRunData>()

export class TestRunData {
  private constructor(
    public readonly run: vscode.TestRun,
    public readonly file: string,
    public readonly request: vscode.TestRunRequest,
  ) {}

  static register(
    run: vscode.TestRun,
    file: string,
    request: vscode.TestRunRequest,
  ) {
    return WEAK_TEST_RUNS_DATA.set(run, new TestRunData(run, file, request))
  }

  static get(run: vscode.TestRun) {
    return WEAK_TEST_RUNS_DATA.get(run)!
  }
}
