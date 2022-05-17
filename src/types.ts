/**
 * Copyright (c) 2014-present, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { ChildProcess } from 'child_process'

export interface Location {
  column: number
  line: number
}

export interface RunArgs {
  args: Array<string>
  replace?: boolean // default is false
}

export interface Options {
  createProcess?: (workspace: any, args: Array<string>) => ChildProcess
  noColor?: boolean
  testNamePattern?: string
  testFileNamePattern?: string
  reporters?: string[]

  /** either to append or replace the Runner process arguments */
  args?: RunArgs
}

/**
 *  Did the thing pass, fail or was it not run?
 */
export type TestReconciliationState =
  | 'Unknown' // The file has not changed, so the watcher didn't hit it
  | 'KnownFail' // Definitely failed
  | 'KnownSuccess' // Definitely passed
  | 'KnownSkip' // Definitely skipped (it.skip)
  | 'KnownTodo' // Definitely pending (it.todo)

/**
 * The Jest Extension's version of a status for
 * individual assertion fails
 *
 */
export interface TestAssertionStatus {
  title: string
  fullName: string
  ancestorTitles: string[]
  status: TestReconciliationState
  message: string
  shortMessage?: string
  terseMessage?: string
  location?: Location
  line?: number
}

/**
 * The Jest Extension's version of a status for
 * whether the file passed or not
 *
 */
export interface TestFileAssertionStatus {
  file: string
  message: string
  status: TestReconciliationState
  assertions: TestAssertionStatus[] | null
}

export interface JestTotalResultsMeta {
  noTestsFound: boolean
}

export const messageTypes = {
  noTests: 1,
  testResults: 3,
  unknown: 0,
  watchUsage: 2,
}

export type MessageType = number
