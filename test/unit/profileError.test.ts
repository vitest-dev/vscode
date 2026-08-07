import { expect } from 'chai'
import { addProfileHint } from '../../packages/extension/src/profileError'

describe('profile error hint', () => {
  it('identifies the profile used for a missing tags configuration error', () => {
    const error =
      'Error: The Vitest config does\'t define any "tags", cannot apply "integration" tag for this test.'

    expect(addProfileHint(error, 'workspace:vitest.config.base.ts')).to.equal(
      [
        error,
        '',
        'Vitest used the "workspace:vitest.config.base.ts" profile for this test.',
        'If another config defines this tag, select its profile with "Execute Using Profile..." or disable this one with "Vitest: Toggle Configs".',
      ].join('\n'),
    )
  })

  it('does not change unrelated errors', () => {
    const error = 'AssertionError: expected 1 to equal 2'
    expect(addProfileHint(error, 'workspace:vitest.config.ts')).to.equal(error)
  })
})
