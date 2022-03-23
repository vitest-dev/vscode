import { expect, describe, it } from "vitest";

describe("addition", () => {
  it("run 1", () => {
    console.log("run");
    expect(1 + 1).toBe(2);
  });

  it("should failed", async () => {
    await new Promise((r) => setTimeout(r, 100));
    expect(1 + 2).toBe(2);
  });

  it.skip("skipped", () => {
    expect(1 + 1).toBe(3);
  });

  it.todo("todo");
  it("same name", () => {});
});

describe("testing", () => {
  it("run 2", () => {
    let a = 10;
    expect(a).toBe(10);
  });
  it("same name 2", () => {});
});
