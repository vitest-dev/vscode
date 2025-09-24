# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Vitest extension for Visual Studio Code** - a VSCode extension that provides test running, debugging, and coverage capabilities for Vitest tests. The extension integrates with VSCode's native TestController API to provide a unified testing experience.

## Architecture

The project uses a monorepo structure with multiple packages that work together:

- **packages/extension** - Main VSCode extension entry point and core logic
- **packages/shared** - Shared utilities and RPC communication between extension and workers
- **packages/worker** - New worker implementation for running Vitest processes
- **packages/worker-legacy** - Legacy worker implementation for older Vitest versions
- **samples/** - Sample projects for testing and demonstration

### Key Components

- **Extension Host** (packages/extension): Manages VSCode integration, test discovery, debugging, coverage
- **Worker Processes** (packages/worker*): Execute Vitest in isolated processes, handle test running and reporting
- **RPC Communication** (packages/shared): Bidirectional communication between extension and workers using birpc
- **API Abstraction**: Supports both child_process and terminal shell types for running Vitest

## Development Commands

### Building
```bash
pnpm build              # Build for production (minified)
pnpm dev                # Build in development mode with watch and sourcemap
pnpm vscode:prepublish  # Prepare for publishing (runs build)
```

### Testing
```bash
pnpm test               # Run unit tests (Mocha-based VSCode tests)
pnpm test:watch         # Run unit tests in watch mode
pnpm test-e2e           # Run end-to-end tests (Vitest-based)
```

### Code Quality
```bash
pnpm typecheck          # TypeScript type checking
pnpm lint               # Run ESLint
pnpm lint:fix           # Run ESLint with auto-fix
```

### Packaging
```bash
pnpm package            # Create .vsix package for distribution
```

## Package Manager

Uses **pnpm** with workspaces. The project requires pnpm@10.11.1 as specified in package.json.

## Build System

- **tsup** - Main build tool for bundling TypeScript
- Multiple entry points: extension, workers, setup files
- Supports both CJS and ESM output formats
- External dependencies like 'vscode' and 'vitest' are excluded from bundles

## Testing Infrastructure

- **Unit Tests**: Mocha-based tests in `test/unit/` using `@vscode/test-cli`
- **E2E Tests**: Vitest-based tests in `test/e2e/`
- **VSCode Test Runner**: Uses `.vscode-test.mjs` configuration
- **Samples**: Multiple sample projects for testing different scenarios

## Worker Architecture

The extension uses a multi-process architecture:
- Extension runs in VSCode extension host
- Worker processes execute Vitest in isolation
- Communication via RPC (birpc)
- Supports both legacy and modern Vitest versions
- Can spawn workers via child_process or terminal

## Key Configuration Files

- `tsup.config.ts` - Build configuration with multiple entry points
- `pnpm-workspace.yaml` - Workspace and catalog definitions
- `.vscode-test.mjs` - VSCode test runner configuration
- `tsconfig.base.json` - Base TypeScript configuration

## Development Notes

- Extension activates on workspaces containing Vitest config files
- Supports both standalone configs and Vitest workspace configurations
- Uses static AST analysis for test discovery (experimentalStaticAstCollect)
- Integrates with VSCode's native testing UI and debugging capabilities
- Supports coverage collection and display
