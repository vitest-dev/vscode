import { expect, describe, it } from "vitest";

describe("addition", () => {
  it("run", () => {
    expect(1 + 1).toBe(2);
  });

  it("failed", () => {
    expect(1 + 1).toBe(3);
  });

  it.skip("skipped", () => {
    expect(1 + 1).toBe(3);
  });
});

describe("haha a a", () => {
  it("run", () => {});
});
