import { expect } from 'chai'
import { astParseFile, type LocalCallDefinition } from '../../packages/worker-legacy/src/collect'

const sorted = (defs: LocalCallDefinition[]) => [...defs].sort((a, b) => a.start - b.start)

describe('astParseFile', () => {
  it('ignores esbuild "using" helper calls like it[1].call(it[2])', () => {
    // simplified output of esbuild's `__callDispose` helper (target < esnext)
    const code = `
var __callDispose = (stack, error, hasError) => {
  var next = (it) => {
    while (it = stack.pop()) {
      var result = it[1] && it[1].call(it[2]);
    }
  };
  return next();
};
describe('suite', () => {
  test('case', () => {
    var _stack = [];
    try {
      const x = __using(_stack, 1);
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  });
});
`
    const { definitions } = astParseFile('/test.ts', code)
    expect(sorted(definitions).map((d) => [d.type, d.name])).to.eql([
      ['suite', 'suite'],
      ['test', 'case'],
    ])
  })

  it('still collects dot-access chains', () => {
    const code = `
describe.concurrent('suite', () => {
  test.skip('case', () => {})
})
`
    const { definitions } = astParseFile('/test.ts', code)
    expect(sorted(definitions).map((d) => [d.type, d.name, d.mode])).to.eql([
      ['suite', 'suite', 'run'],
      ['test', 'case', 'skip'],
    ])
  })
})
