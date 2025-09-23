import { commands, server } from '@vitest/browser/context'

if (server.config.inspector.enabled) {
  // @ts-expect-error send is not defined
  // eslint-disable-next-line antfu/no-top-level-await
  await commands.__vscode_waitForDebugger()
}
