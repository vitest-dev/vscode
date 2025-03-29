/// <reference types="vitest" />
/// <reference types="@vitest/browser/providers/webdriverio" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    target: "es2020",
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/ignored.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: "webdriverio",
      instances: [
        {
          browser: "chrome",
          providerOptions: {
            capabilities: {
              browserName: "chrome",
              browserVersion: "latest",
              platformName: "macOS 11.00",
            },
          },
        },
      ],
    },
  },
});
