import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { log } from '../log'

export class CoverageCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const fileCoverageInfo = await this.getCoverageInfo(document.fileName);

    if (!fileCoverageInfo) {
      log.info(`No coverage info found for ${document.fileName}`);
      return [];
    }

    const branchCoverage = this.formatCoverage(this.getBranchCoverage(fileCoverageInfo));
    const statementCoverage = this.formatCoverage(this.getStatementCoverage(fileCoverageInfo));
    const functionCoverage = this.formatCoverage(this.getFunctionCoverage(fileCoverageInfo));

    const title = `functions: ${functionCoverage}%, statements: ${statementCoverage}%, branches: ${branchCoverage}%`

    const firstLine = new vscode.Range(0, 0, 0, 0);
    const lens = new vscode.CodeLens(firstLine, {
      title,
      command: '',
    });

    return [lens];
  }

  private formatCoverage(coverage: number): string {
    return coverage.toFixed(2).replace('.00', '');
  }

  private async getCoverageInfo(filepath: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    if (!workspaceRoot) {
      log.info('No workspace found');
      return null;
    }
    const coverageDir = path.join(workspaceRoot, 'coverage');
    const coverageFiles = path.join(coverageDir, 'coverage-final.json');

    if (!fs.existsSync(coverageFiles)) {
      log.info(`Path ${coverageFiles} does not exist.`);
      return null;
    }

    const coverageFileContent = await fs.promises.readFile(coverageFiles, 'utf-8');
    const coverageInfo = JSON.parse(coverageFileContent);

    if (!(filepath in coverageInfo)) {
      log.info(`No coverage info found for ${filepath}`);
      return null;
    }

    return coverageInfo[filepath];
  }

  private getCoverageMetric(fileCoverage: any, metric: string): number {
    const totalItems = Object.keys(fileCoverage[metric]).length;

    if (totalItems === 0) {
      return 0;
    }

    const coveredItems = Object.values(fileCoverage[metric]).reduce((covered: number, coverageStatus: any) => {
      return covered + coverageStatus;
    }, 0);

    return (coveredItems / totalItems) * 100;
  }

  private getBranchCoverage(fileCoverage: any): number {
    return this.getCoverageMetric(fileCoverage, 'b');
  }

  private getStatementCoverage(fileCoverage: any): number {
    return this.getCoverageMetric(fileCoverage, 's');
  }

  private getFunctionCoverage(fileCoverage: any): number {
    return this.getCoverageMetric(fileCoverage, 'f');
  }
}
