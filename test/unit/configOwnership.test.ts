import { expect } from 'chai'
import { getConfigSpecificity, isCloserConfig } from '../../packages/extension/src/configOwnership'

describe('config ownership', () => {
  const testFile = '/repo/packages/foo/test/tags.test.ts'

  it('prefers the config defined closest to the test file', () => {
    expect(
      isCloserConfig(
        '/repo/packages/foo/vitest.config.ts',
        '/repo/vitest.config.base.ts',
        testFile,
      ),
    ).to.equal(true)
    expect(
      isCloserConfig(
        '/repo/vitest.config.base.ts',
        '/repo/packages/foo/vitest.config.ts',
        testFile,
      ),
    ).to.equal(false)
  })

  it('keeps the current owner when both configs are in the same folder', () => {
    expect(
      isCloserConfig(
        '/repo/packages/foo/vitest.e2e.config.ts',
        '/repo/packages/foo/vitest.unit.config.ts',
        testFile,
      ),
    ).to.equal(false)
  })

  it('never reassigns to a config that does not contain the test file', () => {
    expect(
      isCloserConfig('/repo/packages/bar/vitest.config.ts', '/repo/vitest.config.ts', testFile),
    ).to.equal(false)
    expect(
      isCloserConfig(
        '/repo/packages/foo/vitest.config.ts',
        '/repo/packages/bar/vitest.config.ts',
        testFile,
      ),
    ).to.equal(true)
  })

  it('scores configs that do not contain the test file with -1', () => {
    expect(getConfigSpecificity('/repo/packages/bar/vitest.config.ts', testFile)).to.equal(-1)
    expect(getConfigSpecificity(undefined, testFile)).to.equal(-1)
  })

  it('scores deeper configs higher', () => {
    const base = getConfigSpecificity('/repo/vitest.config.base.ts', testFile)
    const pkg = getConfigSpecificity('/repo/packages/foo/vitest.config.ts', testFile)
    expect(base).to.be.greaterThan(-1)
    expect(pkg).to.be.greaterThan(base)
  })
})
