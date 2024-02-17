import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "node/**",
  {
    plugins: [nxViteTsPaths()],
    test: {
      globals: true
    },
  },
  "library/**",
  {
    plugins: [nxViteTsPaths()],
    test: {
      globals: true
    },
  },
]);
