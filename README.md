<p align="center">
  <a title="Learn more about Vitest extension for Visual Studio Code" href="https://github.com/vitest-dev/vscode"><img src="./img/cover.png" alt="Vitest extension for Visual Studio Code logo" width="50%" /></a>
</p>

<h1 align="center">Vitest extension for Visual Studio Code. Available on <a href="https://marketplace.visualstudio.com/items?itemName=vitest.explorer">Visual Studio Marketplace</a>.</h1>

![](https://i.ibb.co/bJCbCf2/202203292020.gif)

## Features

- **Run**, **debug**, and **watch** Vitest tests in Visual Studio Code.
- NX support (see the [NX sample](./samples/monorepo-nx/)).
- A `@open` tag can be used when filtering tests, to only show the tests open in the editor.

## Requirements

- Visual Studio Code version >= July 2021 (version 1.59).
- Vitest version >= v0.12.0

## Configuration

- `vitest.enable`: Extension will automatically detect if the current project is using Vitest. If detection fails, extension can be manually enabled via this option.
- `vitest.watchOnStartup`: Whether to activate Watch mode by default when the extension starts.
- `vitest.nodeEnv`: Environment passed to the runner process in addition to
  `process.env`
- `vitest.commandLine`: Command to execute Vitest tests. **It should have the ability
  to append extra arguments**. For example
  `npx vitest` or `yarn test --`. This is a workspace setting. Do not change it in
  the user settings, since it will affect all the projects you open)
- `vitest.debugExclude`: Excludes files matching specified glob patterns from debugging. Default:
  `[\"<node_internals>/**\", \"**/node_modules/**\"]`

## FAQs (Frequently Asked Questions)

### How can I use it in monorepo?

See <https://vitest.dev/guide/workspace.html> for monorepo support.

### How can I use this extension when tests are under a sub directory?

You can use VS Code command `add folder to workspace` to add the sub directory. The extension should work fine.
