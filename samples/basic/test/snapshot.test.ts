import { describe, expect, it } from "vitest";

describe("snapshots", () => {
  it("string", () => {
    expect("abc").toMatchSnapshot();
  });
});
