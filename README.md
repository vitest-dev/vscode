<p align="center">
  <a title="Learn more about Vitest extension for Visual Studio Code" href="https://github.com/vitest-dev/vscode">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./img/cover-light.png">
      <source media="(prefers-color-scheme: light)" srcset="./img/cover-dark.png">
      <img alt="Vitest extension for Visual Studio Code logo" width="50%" src="./img/cover-dark.png">
    </picture></a>
</p>

<h1 align="center">Vitest extension for Visual Studio Code. Available on <a href="https://marketplace.visualstudio.com/items?itemName=vitest.explorer">Visual Studio Marketplace</a>.</h1>

## Features

- **Run**, **debug**, and **watch** Vitest tests in Visual Studio Code.
- **Coverage** support
- **Inline console.log display**: Console logs appear inline in the editor next to the code that produced them
- **Imports duration**: Displays the execution time for each import during continuous test runs.

## Requirements

- Visual Studio Code version >= 1.77.0
- Vitest version >= v1.4.0
- Node.js version >= 18.0.0 (follows Vitest)
- Coverage requires Visual Studio Code >= 1.88.0

## Usage

You can manage tests both from the Testing view and directly within your test files.

Vitest uses vscode's `TestController` API to provide a unified testing experience. You can read the official guide on how to run tests in the [VSCode Documentation](https://code.visualstudio.com/docs/editor/testing).

### In the Testing View

![Testing view](./img/vitest-extension.png 'Testing view')

You can access the extension from the Testing view in the Visual Studio Code sidebar.

The toolbar at the top provides various commands to manage test execution:

- **Refresh Tests**: To reload your test suite, reflecting any new changes.
- **Run All Tests**: To start testing all cases that are currently visible.
- **Debug Tests**: To begin a debugging session for the tests.
- **Run Tests with Coverage**: To start testing all cases that are currently visible, while also collecting code coverage information.
- **Continuous Run/Stop Continuous Run**: To toggle the watch mode for running tests on file changes.
- **Show Output**: To display detailed logs from test executions.
- **Miscellaneous Settings**: To customize the Testing view, such as sorting and grouping tests.

> 💡 Hovering, or right clicking a folder, test file, test suite, or a test will reveal more actions.

The filter bar allows you to narrow down the tests displayed, focusing on specific tests by name, exclusion patterns, or tags.

Icons next to each test indicate their status—passed (checkmark), failed (cross), skipped (arrow), queued (yellow icon), or not executed (dot).

### In the Test File

![Vitest test file](./img/vitest-test-file.png 'Vitest test file')

When viewing a test file, you'll notice test icons in the gutter next to each test case:

- **Run a Single Test:** Click the test icon next to a test case to run that specific test.
- **More Options:** Right-click the test icon to open a context menu with additional options:
  - `Run Test`: Execute the selected test case.
  - `Debug Test`: Start a debugging session for the selected test case.
  - `Run with coverage`: Execute the selected test case while also collecting code coverage information.
  - `Reveal in Test Explorer`: Locate and highlight the test in the centralized Testing view.
  - `Breakpoint Settings`: Set breakpoints to pause execution during debugging. You can add a standard breakpoint, a conditional breakpoint, a logpoint, or a triggered breakpoint.

## Configuration

You can identify if your config is loaded by the extension with `process.env.VITEST_VSCODE` and change the configuration accordingly.

### Workspace Configurations

These options are resolved relative to the [workspace file](https://code.visualstudio.com/docs/editor/workspaces#_multiroot-workspaces) if there is one. If you have a single folder open in Visual Studio Code, paths will be resolved relative to that folder. If there are multiple folders, but there is no workspace file, then paths are resolved as is (so they should be absolute) - this can happen if you change your user config to have multiple folders.

| Key | Description | Type | Default |
|-----|-------------|------|---------|
| `vitest.rootConfig` | The path to your root config file. If you have several Vitest configs, consider using a [Vitest workspace](https://vitest.dev/guide/workspace). | `string` | — |
| `vitest.workspaceConfig` | The path to the [Vitest workspace](https://vitest.dev/guide/workspace) config file. You can only have a single workspace config per VSCode workspace. | `string` | — |
| `vitest.ignoreWorkspace` | Ignores the workspace resolution step. The extension will only look for `vitest.config` files. | `boolean` | — |
| `vitest.configSearchPatternInclude` | [Glob pattern](https://code.visualstudio.com/docs/editor/glob-patterns) used when looking for config files. Applied to _config_ files, not test files inside configs. | `string` | `**/*{vite,vitest}*.config*.{ts,js,mjs,cjs,cts,mts}` |
| `vitest.configSearchPatternExclude` | [Glob pattern](https://code.visualstudio.com/docs/editor/glob-patterns) ignored when looking for config files. Applied to _config_ files, not test files inside configs. If the extension cannot find Vitest, please open an issue. | `string` | `{**/node_modules/**, **/vendor/**, **/.*/**, *.d.ts}` |
| `vitest.runtime` | The default runtime to run tests in. Supported: `auto`, `node`, `deno`. If `auto`, the extension looks for a `deno.enabled` config flag or a `deno.json` file in the root folder. | `string` | `auto` |
| `vitest.shellType` | The method the extension uses to spawn a Vitest process. Useful if you use a custom shell script to set up the environment. When using `terminal`, a websocket connection is established. | `"child_process" \| "terminal"` | `child_process` |
| `vitest.nodeExecutable` | The path to the Node.js executable. If not set, tries to find it via `PATH` or `which`. Only applies when `vitest.shellType` is `child_process`. | `string` | — |
| `vitest.nodeExecArgs` | Arguments to pass to the Node.js executable. Only applies when `vitest.shellType` is `child_process`. | `string[]` | — |
| `vitest.terminalShellPath` | The path to the shell executable. Only applies when `vitest.shellType` is `terminal`. | `string` | — |
| `vitest.terminalShellArgs` | Arguments to pass to the shell executable. Only applies when `vitest.shellType` is `terminal`. | `string[]` | — |
| `vitest.debuggerPort` | Port the debugger will be attached to. Uses `9229` or finds a free port if unavailable. | `number` | `9229` |
| `vitest.debuggerAddress` | TCP/IP address of the process to be debugged. | `string` | `localhost` |
| `vitest.cliArguments` | Additional arguments to pass to the Vitest CLI. Note: `watch`, `reporter`, `api`, and `ui` are ignored. Example: `--mode=staging` | `string` | — |
| `vitest.showImportsDuration` | Show how long it took to import and transform modules. Hovering provides more diagnostics. | `boolean` | — |
| `vitest.watchOnStartup` | Keep Vitest running in the background on startup, rerunning tests when files change. Same as enabling continuous run. | `boolean` | `false` |

> 💡 The `vitest.nodeExecutable` and `vitest.nodeExecArgs` settings are used as `execPath` and `execArgv` when spawning a new `child_process`, and as `runtimeExecutable` and `runtimeArgs` when [debugging a test](https://github.com/microsoft/vscode-js-debug/blob/main/OPTIONS.md).
> The `vitest.terminalShellPath` and `vitest.terminalShellArgs` settings are used as `shellPath` and `shellArgs` when creating a new [terminal](https://code.visualstudio.com/api/references/vscode-api#Terminal)

### Other Options

| Key | Description | Type | Default |
|-----|-------------|------|---------|
| `vitest.filesWatcherInclude` | Glob pattern for the watcher that triggers a test rerun or collects changes. | `string` | `**/*` |
| `vitest.vitestPackagePath` | Path to a `package.json` of a Vitest executable (usually in `node_modules`) if the extension cannot find it. Used to resolve Vitest API paths. Last resort fix. | `string` | — |
| `vitest.nodeEnv` | Environment passed to the runner process in addition to `process.env`. | `object` | — |
| `vitest.debugNodeEnv` | Environment passed to the runner process in addition to `process.env` and `vitest.nodeEnv` when debugging tests. | `object` | — |
| `vitest.debugExclude` | Glob patterns for files to exclude from debugging. | `string[]` | `["<node_internals>/**", "vitest/dist/**"]` |
| `vitest.debugOutFiles` | If source maps are enabled, glob patterns specifying the generated JavaScript files. Patterns starting with `!` exclude files. If not set, generated code is expected alongside its source. | `string[]` | — |
| `vitest.logLevel` | How verbose the logger is in the "Output" channel. | `string` | `info` |
| `vitest.applyDiagnostic` | Show a squiggly line where the error was thrown. Also enables the error count in the File Tab. | `boolean` | `true` |
| `vitest.showInlineConsoleLog` | Show `console.log` messages inline in the editor next to the code that produced them. Logs still appear in test output when disabled. | `boolean` | `true` |
| `vitest.forceCancelTimeout` | Milliseconds to wait for tests to stop gracefully after clicking "Stop" before force-killing Vitest. Consider using the [`signal`](https://vitest.dev/guide/test-context#signal) API in tests instead. | `number` | `1000` |

### Commands

You can reveal the current test file in the test explorer view by selecting the "Reveal in Test Explorer" option (the last option on the screenshot) in the file context:

![Reveal test in explorer](./img/reveal-in-explorer.png 'Reveal test in explorer')

You can also type the same command in the quick picker while the file is open.

![Reveal test in explorer](./img/reveal-in-picker.png 'Reveal test in explorer')

### Run Related Tests

You can run all tests that import the current file by using the "Run Related Tests" command. Its triggers are visible in the same places as "Reveal in Test Explorer".

### Import Breakdown

If you use Vitest 4.1 or higher, during continuous runs the extension will show how long it took to load the module on the same line where the import is defined. This number includes transform time and evaluation time, including static imports.

If you hover over it, you can get a more detailed diagnostic.

![Import breakdown example](./img/import-breakdown.png 'Import breakdown example')

You can disable this feature by turning off `vitest.showImportsDuration`.

## FAQs (Frequently Asked Questions)

### How can I use it in monorepo?

See <https://vitest.dev/guide/workspace.html> for monorepo support.

### How to rerun tests when file is changed?

By default, the extension doens't rerun tests when files change.

Click on the "eye" icon next to the test, file or a directory to enable "continuous run" for a related item. Whenever that test, file or any file in the directory changes, Vitest will rerun that test. Note that Vitest will also rerun tests if an imported module of the file is changed.

![Turn on continuous run button for a test](./img/eye-item-icon.png 'Turn on continuous run button for a test')

To enabled continuous run globally, click on the "eye" icon in the "Test Explorer" row.

![Start continuous run button](./img/eye-global-icon.png 'Start continuous run button')

### How to hide Test Results view when running tests

You can change the behaviour of testing view by modifying `testing.automaticallyOpenTestResults` option:

- `neverOpen` will never open the testing view
- `openOnTestStart` (default) opens the test results view when test starts running
- `openOnTestFailure` opens the test results view if at least one of test fails
- `openExplorerOnTestStart` will open the test tree view when tests starts

This is a vscode's built-in option and will control every plugin.

### The "Stop" button doesn't stop the test fast enough

The stop button stops the test gracefuly in case your test needs to release resources, so Vitest always awaits until the current test is finished. Since Vitest 3.2, you can use a `signal` to stop any pending promises (like a `fetch` or `db` connection) when the test is interrupted:

```ts
test('fetch test', async ({ signal }) => {
  // passing down a signal to fetch will make it so the fetch
  // is rejected when the signal is aborted
  await fetch('some-log-or-stuck-call', { signal })
})
```

Since 1.44.1, Vitest extension will forcefully stop any Vitest process after 1s without waiting for a gracefull exit which may leave hanging processes in the background. Consider using a `signal` API or raising the `vitest.forceCancelTimeout` option.

### I am using `vitest.shellType: terminal`, but I don't see the terminal

The terminal is hidden by default because the content is replicated in the "Test Results" window. However, it might be useful to debug issues with the extension or Vitest itself - to open the terminal in the "Terminals" view you can use the "Vitest: Show Shell Terminal" command.
