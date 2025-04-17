/// <reference types="vitest" />
/// <reference types="@vitest/browser/providers/webdriverio" />

// Configure Vitest (https://vitest.dev/config)

import { defineConfig } from "vitest/config";
import { BrowserCommand } from "vitest/node";

export const debugCommand: BrowserCommand<[]> = async (context) => {
  if (context.provider.name === "webdriverio") {
    //await context.browser.debug(); - this command was inconsistent
    await context.browser.sendCommand("Debugger.enable", {});
    await context.browser.sendCommand("Debugger.pause", {});
  }
};

declare module '@vitest/browser/context' {
  interface BrowserCommands {
    debugCommand: () => Promise<void>
  }
}

export default defineConfig({
  esbuild: {
    target: "esnext",
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
            browserName: 'chrome',
            browserVersion: 'stable',
            "goog:chromeOptions": {
              args: [
                // Note: needs to be commented out to enable running without debug
                "--remote-debugging-port=9227"
              ],
            },
          },
        },
      ],
    },
  },
});
