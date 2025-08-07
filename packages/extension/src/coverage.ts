import { readFileSync } from 'node:fs'
import { IstanbulCoverageContext, IstanbulMissingCoverageError } from 'istanbul-to-vscode'
import { join } from 'pathe'
import { finalCoverageFileName } from './constants'

export const coverageContext = new IstanbulCoverageContext()

export function readCoverageReport(reportsDirectory: string) {
  try {
    return JSON.parse(readFileSync(join(reportsDirectory, finalCoverageFileName), 'utf8'))
  }
  catch (err: any) {
    throw new IstanbulMissingCoverageError(reportsDirectory, err)
  }
}
