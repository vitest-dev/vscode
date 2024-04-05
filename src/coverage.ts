import { readFileSync } from 'node:fs'
import { IstanbulCoverageContext, IstanbulMissingCoverageError } from 'istanbul-to-vscode'
import { join } from 'pathe'

export const coverageContext = new IstanbulCoverageContext()

const FINAL_COVERAGE_FILE_NAME = 'coverage-final.json'

export function readCoverageReport(reportsDirectory: string) {
  try {
    return JSON.parse(readFileSync(join(reportsDirectory, FINAL_COVERAGE_FILE_NAME), 'utf8'))
  }
  catch (err: any) {
    throw new IstanbulMissingCoverageError(reportsDirectory, err)
  }
}
