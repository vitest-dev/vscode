import type { SourceMap } from 'node:module'
import { relative } from 'pathe'
import type { TemplateLiteral } from 'acorn'
import { parse } from 'acorn'
import { TraceMap, originalPositionFor } from '@vitest/utils/source-map'
import { ancestor as walkAst } from 'acorn-walk'

import {
  calculateSuiteHash,
  generateHash,
  interpretTaskModes,
  someTasksAreOnly,
} from '@vitest/runner/utils'
import type { File, Suite, Test } from 'vitest'
import type { WorkspaceProject } from 'vitest/node'

interface ParsedFile extends File {
  start: number
  end: number
}

interface ParsedTest extends Test {
  start: number
  end: number
}

interface ParsedSuite extends Suite {
  start: number
  end: number
}

interface LocalCallDefinition {
  start: number
  end: number
  name: string
  unknown: boolean
  type: 'suite' | 'test'
  mode: 'run' | 'skip' | 'only' | 'todo'
  task: ParsedSuite | ParsedFile | ParsedTest
}

export interface FileInformation {
  file: File
  filepath: string
  parsed: string
  map: SourceMap | { mappings: string } | null
  definitions: LocalCallDefinition[]
}

const debug = process.env.VITEST_VSCODE_LOG !== 'info'
  ? (...args: any[]) => {
    // eslint-disable-next-line no-console
      console.info(...args)
    }
  : undefined

const verbose = process.env.VITEST_VSCODE_LOG === 'verbose'
  ? (...args: any[]) => {
      // eslint-disable-next-line no-console
      console.info(...args)
    }
  : undefined

export function astParseFile(filepath: string, code: string) {
  const ast = parse(code, {
    ecmaVersion: 'latest',
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    allowImportExportEverywhere: true,
  })

  if (verbose) {
    verbose('Collecting', filepath, code)
  }
  else {
    debug?.('Collecting', filepath)
  }
  const definitions: LocalCallDefinition[] = []
  const getName = (callee: any): string | null => {
    if (!callee) {
      return null
    }
    if (callee.type === 'Identifier') {
      return callee.name
    }
    if (callee.type === 'CallExpression') {
      return getName(callee.callee)
    }
    if (callee.type === 'TaggedTemplateExpression') {
      return getName(callee.tag)
    }
    if (callee.type === 'MemberExpression') {
      // direct call as `__vite_ssr_exports_0__.test()`
      if (callee.object?.name?.startsWith('__vite_ssr_')) {
        return getName(callee.property)
      }
      // call as `__vite_ssr__.test.skip()`
      return getName(callee.object?.property)
    }
    return null
  }

  walkAst(ast as any, {
    CallExpression(node) {
      const { callee } = node as any
      const name = getName(callee)
      let unknown = false
      if (!name) {
        verbose?.('Unknown call', callee)
        return
      }
      if (!['it', 'test', 'describe', 'suite'].includes(name)) {
        verbose?.(`Skipping ${name} (unknown call)`)
        return
      }
      const property = callee?.property?.name
      let mode = !property || property === name ? 'run' : property
      if (mode === 'each') {
        debug?.('Skipping `.each` (support not implemented yet)', name)
        return
      }

      let start: number
      const end = node.end
      // .each
      if (callee.type === 'CallExpression') {
        start = callee.end
      }
      else if (callee.type === 'TaggedTemplateExpression') {
        start = callee.end + 1
      }
      else {
        start = node.start
      }

      const {
        arguments: [messageNode],
      } = node
      let message: string | null = null

      if (messageNode.type === 'Literal') {
        message = String(messageNode.value)
      }
      else if (messageNode.type === 'Identifier') {
        message = messageNode.name
      }
      else if (messageNode.type === 'TemplateLiteral') {
        message = mergeTemplateLiteral(messageNode as any)
      }
      else {
        message = '<unknown>'
        unknown = true
        // TODO: support dynamic messages
      }

      // cannot statically analyze, so we always skip it
      if (mode === 'skipIf' || mode === 'runIf') {
        mode = 'skip'
      }
      debug?.('Found', name, message, `(${mode})`)
      definitions.push({
        start,
        end,
        name: message,
        unknown,
        type: name === 'it' || name === 'test' ? 'test' : 'suite',
        mode,
        task: null as any,
      } satisfies LocalCallDefinition)
    },
  })
  return {
    ast,
    definitions,
  }
}

export async function astCollectTests(
  ctx: WorkspaceProject,
  filepath: string,
): Promise<null | FileInformation> {
  const request = await ctx.vitenode.transformRequest(filepath, filepath, 'web')
  // TODO: error cannot parse
  const testFilepath = relative(ctx.config.root, filepath)
  if (!request) {
    debug?.('Cannot parse', testFilepath, '(vite didn\'t return anything)')
    return null
  }
  const { definitions, ast } = astParseFile(filepath, request.code)
  const file: ParsedFile = {
    filepath,
    type: 'suite',
    id: /* @__PURE__ */ generateHash(`${testFilepath}${ctx.config.name || ''}`),
    name: testFilepath,
    mode: 'run',
    tasks: [],
    start: ast.start,
    end: ast.end,
    projectName: ctx.getName(),
    meta: { typecheck: true },
    file: null!,
  }
  file.file = file
  if (verbose) {
    verbose('Collecing', testFilepath, request.code)
  }
  else {
    debug?.('Collecting', testFilepath)
  }
  const indexMap = createIndexMap(request.code)
  const map = request.map && new TraceMap(request.map as any)
  let lastSuite: ParsedSuite = file
  const updateLatestSuite = (index: number) => {
    while (lastSuite.suite && lastSuite.end < index) {
      lastSuite = lastSuite.suite as ParsedSuite
    }
    return lastSuite
  }
  definitions
    .sort((a, b) => a.start - b.start)
    .forEach((definition) => {
      const latestSuite = updateLatestSuite(definition.start)
      let mode = definition.mode
      if (latestSuite.mode !== 'run') {
        // inherit suite mode, if it's set
        mode = latestSuite.mode
      }
      const processedLocation = indexMap.get(definition.start)
      let location: { line: number; column: number } | undefined
      if (map && processedLocation) {
        const originalLocation = originalPositionFor(map, {
          line: processedLocation.line,
          column: processedLocation.column,
        })
        if (originalLocation.column != null) {
          verbose?.(
            `Found location for`,
            definition.type,
            definition.name,
            `${processedLocation.line}:${processedLocation.column}`,
            '->',
            `${originalLocation.line}:${originalLocation.column}`,
          )
          location = originalLocation
        }
        else {
          debug?.(
            'Cannot find original location for',
            definition.type,
            definition.name,
            `${processedLocation.column}:${processedLocation.line}`,
          )
        }
      }
      else {
        debug?.(
          'Cannot find original location for',
          definition.type,
          definition.name,
          `${definition.start}`,
        )
      }
      if (definition.type === 'suite') {
        const task: ParsedSuite = {
          type: definition.type,
          id: '',
          suite: latestSuite,
          file,
          tasks: [],
          mode,
          name: definition.name,
          end: definition.end,
          start: definition.start,
          location,
          meta: {
            typecheck: true,
          },
        }
        definition.task = task
        latestSuite.tasks.push(task)
        lastSuite = task
        return
      }
      const task: ParsedTest = {
        type: definition.type,
        id: '',
        suite: latestSuite,
        file,
        mode,
        context: {} as any, // not used on the server
        name: definition.name,
        end: definition.end,
        start: definition.start,
        location,
        meta: {
          typecheck: true,
        },
      }
      definition.task = task
      latestSuite.tasks.push(task)
    })
  calculateSuiteHash(file)
  const hasOnly = someTasksAreOnly(file)
  interpretTaskModes(
    file,
    ctx.config.testNamePattern,
    hasOnly,
    false,
    ctx.config.allowOnly,
  )
  if (!file.tasks.length) {
    file.result = {
      state: 'fail',
      errors: [
        {
          name: 'Error',
          message: `No test suite found in file ${filepath}`,
        },
      ],
    }
  }
  return {
    file,
    parsed: request.code,
    filepath,
    map: request.map,
    definitions,
  }
}

function mergeTemplateLiteral(node: TemplateLiteral): string {
  let result = ''
  let expressionsIndex = 0

  for (let quasisIndex = 0; quasisIndex < node.quasis.length; quasisIndex++) {
    result += node.quasis[quasisIndex].value.raw
    if (expressionsIndex in node.expressions) {
      result += `{${node.expressions[expressionsIndex]}}`
      expressionsIndex++
    }
  }
  return result
}

function createIndexMap(source: string) {
  const map = new Map<number, { line: number; column: number }>()
  let index = 0
  let line = 1
  let column = 1
  for (const char of source) {
    map.set(index++, { line, column })
    if (char === '\n' || char === '\r\n') {
      line++
      column = 0
    }
    else {
      column++
    }
  }
  return map
}
