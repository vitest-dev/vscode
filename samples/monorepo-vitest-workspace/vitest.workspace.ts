import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/**",
  {
    test: {
      environment: "happy-dom",
    },
  },
]);
