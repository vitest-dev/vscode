import { describe, expect, it } from "vitest";

describe("addition", () => {
  describe("haha", () => {
    it("run", () => {
      console.log("=================");
      console.log("Console Output");
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
});

describe("testing", () => {
  it("run", () => {
    let a = 10;
    expect(a).toBe(10);
  });
  it("same name 2", () => {});

  it("mul", () => {
    expect(5 * 5).toBe(25);
  });
});
