/// <reference types="vitest" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  test: {
    root: "test",
  },
});
