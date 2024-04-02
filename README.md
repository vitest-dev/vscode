<p align="center">
  <a title="Learn more about Vitest extension for Visual Studio Code" href="https://github.com/vitest-dev/vscode"><img src="./img/cover.png" alt="Vitest extension for Visual Studio Code logo" width="50%" /></a>
</p>

<h1 align="center">Vitest extension for Visual Studio Code. Available on <a href="https://marketplace.visualstudio.com/items?itemName=vitest.explorer">Visual Studio Marketplace</a>.</h1>

![](https://i.ibb.co/bJCbCf2/202203292020.gif)

## Features

- **Run**, **debug**, and **watch** Vitest tests in Visual Studio Code.
- NX support (see the [NX sample](./samples/monorepo-nx/)).
- An `@open` tag can be used when filtering tests, to only show the tests open in the editor.

## Requirements

- Visual Studio Code version >= 1.77.0.
- Vitest version >= v1.4.0

## Configuration

You can identify if your config is loaded by the extension with `process.env.VITEST_VSCODE` and change the configuration accordingly.

- `vitest.rootConfig`: The path to your root config file. If you have several Vitest configs, consider using a [Vitest workspace](https://vitest.dev/guide/workspace).
- `vitest.workspaceConfig`: The path to the [Vitest workspace](https://vitest.dev/guide/workspace) config file. You can only have a single workspace config per VSCode workspace.
- `vitest.configSearchPatternExclude`: [Glob pattern](https://code.visualstudio.com/docs/editor/glob-patterns) that should be ignored when this extension looks for config files. Note that this is applied to _config_ files, not test files inside configs.
- `vitest.packagePath`: The path to a `package.json` file of a Vitest executable (it's usually inside `node_modules`) in case the extension cannot find it. It will be used to resolve Vitest API paths. This should be used as a last resort fix. If the extension cannot find Vitest, please open an issue.
- `vitest.nodeExecutable`: This extension spawns another process and will use this value as `execPath` argument.
- `vitest.nodeEnv`: Environment passed to the runner process in addition to
  `process.env`
- `vitest.debugExclude`: Excludes files matching specified glob patterns from debugging. Default:
  `[\"<node_internals>/**\", \"**/node_modules/**\"]`

## FAQs (Frequently Asked Questions)

### How can I use it in monorepo?

See <https://vitest.dev/guide/workspace.html> for monorepo support.

### How can I use this extension when tests are under a sub directory?

You can use VS Code command `add folder to workspace` to add the sub directory. The extension should work fine.

### Why is the extension not activated?

The extension looks for [Vitest config](https://vitest.dev/config/file.html) or [Vitest workspace config](https://vitest.dev/guide/workspace.html) to establish the connection with Vitest. If you have several config files, it's recommended to combine them in a single [Vitest workspace](https://vitest.dev/guide/workspace.html) for a better CPU performance (only have a single Vitest instance instead of several).
