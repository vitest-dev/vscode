# Shared base config

Reproduces [#799](https://github.com/vitest-dev/vscode/issues/799): a shared
base config (`vitest.config.base.ts`) matches the extension's `configGlob` and
claims the same test files as the package-level config that merges it.

```
vitest.config.base.ts              shared config with no tags
packages/foo/vitest.config.ts      mergeConfig(base) + leaf tag definition
packages/foo/test/tagged.test.ts   test using the leaf tag
```

The extension resolves the shallow root config first, so opening the file
collects the test with that config and reproduces the missing-tags error. The
end-to-end test verifies that the error identifies the selected profile and
explains how to choose another one.
