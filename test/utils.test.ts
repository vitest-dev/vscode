import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnVitestVersion } from '../src/pure/utils'

afterEach(() => {
  vi.restoreAllMocks()
})

// Mock vscode ("pure" modules aren't quite pure)
vi.mock('vscode', () => {
  return {
    default: { myDefaultKey: vi.fn() },
    namedExport: vi.fn(),
    window: {
      createOutputChannel: () => {
        return {
          appendLine: vi.fn(),
        }
      },
    },
  }
})

describe('utils', () => {
  describe('spawnVitestVersion', () => {
    it('should return undefined when passing an unkown command', async () => {
      const result = await spawnVitestVersion('unknown-command', ['xxx'], {})
      expect(result).toBeUndefined()
    })

    it('should return undefined when the commmand don\'t return any version', async () => {
      const result = await spawnVitestVersion('/bin/ls', ['-l'], {})
      expect(result).toBeUndefined()
    })
  })

  // TODO mock spawn
  // describe('xxx', () => {
  //   const spy = vi.mock('childProcess', 'spawnSync', (a, b) => vi.fn())

  //   it('should return the version when the command return a version', async () => {
  //     await expect(() => tryBoth('xxx', ['a', 'b'], { one: '1', two: '2' })).rejects.toThrowError('xx')

  //     expect(spy).toHaveBeenCalledTimes(2)
  //   })
  // })
})
