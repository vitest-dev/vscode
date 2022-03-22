import { expect, describe, it } from "vitest";

describe("addition", () => {
  it("run", () => {
    expect(1 + 1).toBe(2);
  });

  it("failed", () => {
    expect(1 + 2).toBe(2);
  });

  it.skip("skipped", () => {
    expect(1 + 1).toBe(3);
  });

  it.todo("todo");
  it("same name", () => {});
});

describe("testing", () => {
  it("run", () => {
    let a = 10;
    expect(a).toBe(10);
  });
  it("same name", () => {});
});
