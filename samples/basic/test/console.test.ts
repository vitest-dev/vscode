import { describe, it } from "vitest";

describe("console", () => {
  it("basic", () => {
    console.log([
      "string",
      { hello: "world" },
      1234,
      /regex/g,
      true,
      false,
      null,
    ]);
  });

  it("async", async () => {
    console.log("1st");
    await sleep(200);
    console.log("2nd");
    await sleep(200);
    console.log("3rd");
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
