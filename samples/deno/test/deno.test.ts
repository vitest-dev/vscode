import { expect, it } from 'vitest'

it('deno-exists', () => {
  expect('Deno' in globalThis).toBe(true)
})
