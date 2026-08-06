import { expect, it } from 'vitest'

// only passes when run with packages/foo/vitest.config.ts,
// not with the discovered root vitest.config.base.ts (#799)
it('runs with the leaf config', () => {
  expect(process.env.CONFIG_NAME).toBe('leaf')
})
