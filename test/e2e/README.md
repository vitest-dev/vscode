# test-e2e

To open playwright inspector, either run with `PWDEBUG`

```sh
PWDEBUG=1 pnpm test-e2e
```

or use `page.pause` inside a test code

```ts
await page.pase()
```
