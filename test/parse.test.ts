import { expect, describe, it } from 'vitest';
import { parse } from '../src/parsers/babel_parser';

describe('parse', () => {
  it('parse', () => {
    const out = parse('x', "" +
      "let a = 10;\n" +
      "describe(`x ${a} sdf`, () => {\n" +
      "    for (let i = 0; i < 5; i++){it('run' + i, () => {})}\n" +
      "}); \n" +
      "test('add', () => {})"
    );

    console.dir(out.describeBlocks);
    console.dir(out.itBlocks);
  });
});