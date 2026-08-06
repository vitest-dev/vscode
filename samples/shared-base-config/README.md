# Shared base config

Reproduces [#799](https://github.com/vitest-dev/vscode/issues/799): a shared
base config (`vitest.config.base.ts`) matches the extension's `configGlob` and
claims the same test files as the package-level config that merges it.

```
vitest.config.base.ts                    CONFIG_NAME=base
packages/foo/vitest.config.ts            mergeConfig(base) + CONFIG_NAME=leaf
packages/foo/test/which-config.test.ts   passes only with CONFIG_NAME=leaf
```

The gutter "Run Test" button must execute the test with the most specific
config (`packages/foo/vitest.config.ts`). Covered by
`test/e2e/shared-base-config.test.ts`.
