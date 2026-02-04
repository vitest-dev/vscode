import { expect, test } from "vitest";

test('process.env', () => {
  expect(process.env.TEST).toBe('true');
  expect(process.env.VITEST).toBe('true');
  expect(process.env.NODE_ENV).toBe('test');
  expect(process.env.VITEST_VSCODE).toBe('true');

  if(process.env.TEST_CUSTOM_ENV_2 === undefined) {
    expect(process.env.TEST_CUSTOM_ENV).toBe('hello');
  }
  else {
    expect(process.env.TEST_CUSTOM_ENV).toBe('hello new');
    expect(process.env.TEST_CUSTOM_ENV_2).toBe('world');
  }
});
