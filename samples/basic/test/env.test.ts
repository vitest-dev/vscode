import { test, expect } from "vitest";

test('process.env', () => {
  expect(process.env.TEST).toBe('true');
  expect(process.env.VITEST).toBe('true');
  expect(process.env.NODE_ENV).toBe('true');
  expect(process.env.VITEST_VSCODE).toBe('true');
  expect(process.env.TEST_CUSTOM_ENV).toBe('hello');
});
