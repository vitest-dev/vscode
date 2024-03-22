import { expect } from 'chai'
import { findFirstUniqueFolderNames } from '../src/api/pkg'

it('correctly makes prefixes unique', () => {
  expect(findFirstUniqueFolderNames([
    '/User/usr/vitest/packages/pkg1/react/vitest.config.ts',
    '/User/usr/vitest/packages/pkg2/react/vitest.config.ts',
    '/User/usr/vitest/packages/pkg2/some-new-field/react/vitest.config.ts',
    '/User/usr/vitest/react/vitest.config.ts',
  ])).to.eql([
    'pkg1',
    'pkg2',
    'some-new-field',
    'vitest',
  ])
})
