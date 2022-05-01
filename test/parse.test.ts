import { describe, expect, it } from "vitest";
import parse from "../src/pure/parsers";

describe("parse", () => {
  it("parse", () => {
    const out = parse(
      "x.js",
      "" +
        "let a = 10;\n" +
        "describe(`x ${a} sdf`, () => {\n" +
        "    for (let i = 0; i < 5; i++){it('run' + i, () => {})}\n" +
        "}); \n" +
        "test('add', () => {})",
    );

    expect(out.describeBlocks.length).toBe(1);
    expect(out.itBlocks.length).toBe(1);
  });

  it("parse decorator", () => {
    const out = parse(
      "x.ts",
      "" +
        "let a = 10;\n" +
        "describe(`x ${a} sdf`, () => {\n" +
        "    class B { \n" +
        "         constructor(@Inject(A) public a: A) {} \n" +
        "    } " +
        "});",
    );

    expect(out.describeBlocks.length).toBe(1);
  });
});
