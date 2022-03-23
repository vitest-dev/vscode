/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from "vite";

export default defineConfig({
  test: {
    include: ["src/should_included_test.ts", "test/**"],
  },
});
