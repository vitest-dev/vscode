import { resolve } from 'node:path'
import type { RunnerTestCase, RunnerTestSuite } from 'vitest'
import { describe, expect, it } from 'vitest'
import { createVitest } from 'vitest/node'
import { astCollectTests } from '../src/worker/collect'

describe('can discover tests', () => {
  it.for([
    'todo-import-suite.ts',
    'todo-globals-suite.ts',
  ])('can discover todo tests inside a suite in %s', async (fixture) => {
    const vitest = await createVitest('test', { config: false })
    const file = await astCollectTests(
      vitest.getCoreWorkspaceProject(),
      resolve(`test-e2e/fixtures/collect/${fixture}`),
      'web',
    )
    expect(file.filepath).toBe(resolve(`test-e2e/fixtures/collect/${fixture}`))
    expect(file.name).toBe(`test-e2e/fixtures/collect/${fixture}`)

    expect(file.tasks).toHaveLength(1)
    const suite = file.tasks[0] as RunnerTestSuite
    expect(suite.name).toBe('TicketDetailBottomBar')
    expect(suite.mode).toBe('run')
    expect(suite.location).toMatchObject({
      line: 3,
      column: 0,
    })
    expect(suite.tasks).toHaveLength(2)

    const [testTask, suiteTask] = suite.tasks as [RunnerTestCase, RunnerTestSuite]
    expect(testTask.name).toBe('emits %s event when button is clicked')
    expect((testTask as any).dynamic).toBe(true)
    expect(testTask.mode).toBe('run')
    expect(testTask.location).toMatchObject({
      line: 4,
      column: 31, // TODO: should it be 5 instead?
    })

    expect(suiteTask.name).toBe('Drafts')
    expect(suiteTask.mode).toBe('skip')
    expect(suiteTask.location).toMatchObject({
      line: 10,
      column: 2,
    })
    expect(suiteTask.tasks).toHaveLength(2)

    const [todo1, todo2] = suiteTask.tasks as RunnerTestCase[]
    expect(todo1.name).toBe('should not display draft information if ticket has no draft')
    expect(todo1.mode).toBe('todo')
    expect(todo1.location).toMatchObject({
      line: 11,
      column: 4,
    })

    expect(todo2.name).toBe('should display draft information if ticket has a draft')
    expect(todo2.mode).toBe('todo')
    expect(todo2.location).toMatchObject({
      line: 12,
      column: 4,
    })
  })
})
