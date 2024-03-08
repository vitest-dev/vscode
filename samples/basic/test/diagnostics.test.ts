import { describe, test } from "vitest";

describe("testing", () => {
  test("number 1", () => { })
});
describe("testing", () => {
  test("number 2", () => { })
  test("number 2", () => { })
  describe("testing1", () => {})
});

describe("", () => { })

test.each([1, 2])('a', () =>{})
