/// <reference types="vitest" />
/// <reference types="@vitest/browser/providers/webdriverio" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from "vitest/config";
import { BrowserCommand } from "vitest/node";

export const debugCommand: BrowserCommand<[]> = async (context) => {
  if (context.provider.name === "webdriverio") {
    await context.browser.debug();
  }
};

export default defineConfig({
  esbuild: {
    target: "es2020",
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/ignored.test.ts"],
    browser: {
      enabled: true,
      provider: "webdriverio",
      commands: { debugCommand },
      instances: [
        {
          browser: "chrome",
          capabilities: {
            "goog:chromeOptions": {
              args: [
                "--remote-debugging-port=9224"
              ],
            },
          },
        },
      ],
    },
  },
});
