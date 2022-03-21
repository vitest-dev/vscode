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

  it.todo("emmm");
  it("123", () => {});
});

describe("haha a a", () => {
  it("run", () => {
    let a = 10;
    expect(a).toBe(10);
  });
  it("123", () => {});
});
