# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.2.43](https://github.com/vitest-dev/vscode/compare/v0.2.42...v0.2.43) (2023-10-18)

### [0.2.42](https://github.com/vitest-dev/vscode/compare/v0.2.41...v0.2.42) (2023-07-01)


### Bug Fixes

* Revert back to drive path capitalization on windows ([#161](https://github.com/vitest-dev/vscode/issues/161)) ([1afa62e](https://github.com/vitest-dev/vscode/commit/1afa62eaf234b6885dba7d0cf84e39400b2ce0a4))

### [0.2.41](https://github.com/vitest-dev/vscode/compare/v0.2.40...v0.2.41) (2023-05-18)


### Bug Fixes

* spawn err on mac ([74d3ab2](https://github.com/vitest-dev/vscode/commit/74d3ab2359a1ed21584ab2d8bdfb439ae9ea7d86))

### [0.2.40](https://github.com/vitest-dev/vscode/compare/v0.2.39...v0.2.40) (2023-05-18)


### Bug Fixes

* spawn() requires a command name, not a full path ([#139](https://github.com/vitest-dev/vscode/issues/139)) ([fe7955e](https://github.com/vitest-dev/vscode/commit/fe7955e81dafb799b240c2db0e22bf828db2b36e))

### [0.2.39](https://github.com/vitest-dev/vscode/compare/v0.2.38...v0.2.39) (2023-02-08)


### Bug Fixes

* [#107](https://github.com/vitest-dev/vscode/issues/107) speed up activation events ([f4842b5](https://github.com/vitest-dev/vscode/commit/f4842b55de9b41e5e3e390b4408b19140a1b1942))

### [0.2.38](https://github.com/vitest-dev/vscode/compare/v0.2.37...v0.2.38) (2023-02-08)


### Features

* make skipFiles of launch config configurable via debugExclude setting ([1c07064](https://github.com/vitest-dev/vscode/commit/1c070648671e4c1c426dc564a6a110ee437e159a))

### [0.2.37](https://github.com/vitest-dev/vscode/compare/v0.2.36...v0.2.37) (2023-01-20)

### [0.2.36](https://github.com/vitest-dev/vscode/compare/v0.2.35...v0.2.36) (2023-01-03)


### Bug Fixes

* read package.json to check if a folder is a Vitest env ([df13127](https://github.com/vitest-dev/vscode/commit/df1312719887af6a89630a0e6bbd58a0da0629d7))
* run single test on Windows not working properly ([c037333](https://github.com/vitest-dev/vscode/commit/c03733336b36dec6cde3b6da85c4be5da7f8284d))
* tests still say Running after test run finishes ([ef2d017](https://github.com/vitest-dev/vscode/commit/ef2d01794a3fcba293126c3c5a42a1ec239b8b0c))
* unable to cancel in-progress test runs ([7ca7f4a](https://github.com/vitest-dev/vscode/commit/7ca7f4a9f38a6cf3df2707d4bc5a1763f5e528e2))

### [0.2.35](https://github.com/vitest-dev/vscode/compare/v0.2.34...v0.2.35) (2022-12-29)


### Bug Fixes

* map error to correct position when no sourcePos ([9d47d7d](https://github.com/vitest-dev/vscode/commit/9d47d7de20f021c933ba4b32dd05ffdf0a961875))

### [0.2.34](https://github.com/vitest-dev/vscode/compare/v0.2.33...v0.2.34) (2022-11-19)


### Bug Fixes

* don't raise version warning if vitest is not installed yet ([744032c](https://github.com/vitest-dev/vscode/commit/744032c46cffec24aad8d3817063f07329284c62))
* only collect test result once ([f330530](https://github.com/vitest-dev/vscode/commit/f330530b0f895f5834da08f5fbebe7f287a82497))

### [0.2.33](https://github.com/vitest-dev/vscode/compare/v0.2.32...v0.2.33) (2022-11-19)


### Bug Fixes

* windows drive letter match issue ([5c58ede](https://github.com/vitest-dev/vscode/commit/5c58edeb3580f9c378c6a38de76ae8fd6062c07c))

### [0.2.32](https://github.com/vitest-dev/vscode/compare/v0.2.31...v0.2.32) (2022-10-13)

### [0.2.31](https://github.com/vitest-dev/vscode/compare/v0.2.29...v0.2.31) (2022-10-13)

### [0.2.30](https://github.com/vitest-dev/vscode/compare/v0.2.29...v0.2.30) (2022-08-30)

### Bug Fixes

* Allow overwriting of the host parameter to solve the [issue 55](https://github.com/vitest-dev/vscode/issues/55).

### [0.2.29](https://github.com/vitest-dev/vscode/compare/v0.2.28...v0.2.29) (2022-08-30)


### Bug Fixes

* add more error message in when test not found ([dfdb154](https://github.com/vitest-dev/vscode/commit/dfdb1549dc99768cddb4bec798c1d7f5574bd752))
* enrich error context around test not found ([443ed52](https://github.com/vitest-dev/vscode/commit/443ed52a263142258e68a358254e4543a2a82ce1))

### [0.2.28](https://github.com/vitest-dev/vscode/compare/v0.2.27...v0.2.28) (2022-08-26)

### [0.2.27](https://github.com/vitest-dev/vscode/compare/v0.2.26...v0.2.27) (2022-08-06)


### Bug Fixes

* vitest env detect error [#61](https://github.com/vitest-dev/vscode/issues/61) ([9edf4c1](https://github.com/vitest-dev/vscode/commit/9edf4c1d6de56daafc44bebfad8fb7e47de98a02))

### [0.2.26](https://github.com/vitest-dev/vscode/compare/v0.2.25...v0.2.26) (2022-08-06)


### Bug Fixes

* conservatively display window error ([1312f2e](https://github.com/vitest-dev/vscode/commit/1312f2e98063b086c7bfcb4fc4bafed15dde3c4b))

### [0.2.25](https://github.com/vitest-dev/vscode/compare/v0.2.24...v0.2.25) (2022-08-06)


### Bug Fixes

* run partial test suite on windows ([#64](https://github.com/vitest-dev/vscode/issues/64)) ([a6019a4](https://github.com/vitest-dev/vscode/commit/a6019a45d45abb0411f3e6a67eaf5c5f00dead2e))
* use source-mapped line when showing result. ([9db4fec](https://github.com/vitest-dev/vscode/commit/9db4fec1ca2336ccc53f0a4601e241268c5887e5))

### [0.2.24](https://github.com/vitest-dev/vscode/compare/v0.2.23...v0.2.24) (2022-08-06)

### [0.2.23](https://github.com/vitest-dev/vscode/compare/v0.2.22...v0.2.23) (2022-07-24)


### Bug Fixes

* should try activate if contains package.json ([6d17b9f](https://github.com/vitest-dev/vscode/commit/6d17b9fa50330d56d159d29d35958c20d44219c6))

### [0.2.22](https://github.com/vitest-dev/vscode/compare/v0.2.21...v0.2.22) (2022-07-23)


### Features

* **runhandler:** add disabledWorkspaceFolders configuration ([67ba85c](https://github.com/vitest-dev/vscode/commit/67ba85c6772cb7bc2c340732a1d2ddb58a02bec3)), closes [#13](https://github.com/vitest-dev/vscode/issues/13)


### Bug Fixes

* filter disabled workspace upfront ([a4fc22b](https://github.com/vitest-dev/vscode/commit/a4fc22b2b48f9d26cc25bfea1f9931a1e954df2d))
* hidden test in side panel ([f89ce2f](https://github.com/vitest-dev/vscode/commit/f89ce2f34d66af3c2f677dc140256c75dbc771e4))
* vitest.exclude not working  [#60](https://github.com/vitest-dev/vscode/issues/60) ([9cd3218](https://github.com/vitest-dev/vscode/commit/9cd3218a0b430fd4d4a2deb565e6ac343f24470d))

### [0.2.21](https://github.com/vitest-dev/vscode/compare/v0.2.20...v0.2.21) (2022-07-23)


### Bug Fixes

* no uppercase path allowed for test file ([f688bb5](https://github.com/vitest-dev/vscode/commit/f688bb50dc953c3c29ed36ed184eb006e8d41e00))

### [0.2.20](https://github.com/vitest-dev/vscode/compare/v0.2.19...v0.2.20) (2022-07-03)


### Bug Fixes

* replace enqueued with started on test start ([d287772](https://github.com/vitest-dev/vscode/commit/d28777200477ca85624cc24c933f7307d203af5f))

### [0.2.19](https://github.com/vitest-dev/vscode/compare/v0.2.18...v0.2.19) (2022-06-20)


### Bug Fixes

* don't stop debugging if restarted ([ae29785](https://github.com/vitest-dev/vscode/commit/ae29785251fbf7b8c3f9187eeddd19624495ab11))

### [0.2.18](https://github.com/vitest-dev/vscode/compare/v0.2.17...v0.2.18) (2022-06-19)


### Features

* use --api on debug mode ([77fd7b3](https://github.com/vitest-dev/vscode/commit/77fd7b3b7273a47d369f90babc816b351cd69561))

### [0.2.17](https://github.com/vitest-dev/vscode/compare/v0.2.16...v0.2.17) (2022-06-19)


### Bug Fixes

* invoke onCollect when ws connected ([40bdd0a](https://github.com/vitest-dev/vscode/commit/40bdd0a8acecec682c9214cb71d965b716bca3ff))

### [0.2.16](https://github.com/vitest-dev/vscode/compare/v0.2.15...v0.2.16) (2022-06-19)


### Features

* show enqueue status, show test result faster ([ff2ad74](https://github.com/vitest-dev/vscode/commit/ff2ad744cd96dc064102559d1c64348054cf968e))


### Bug Fixes

* update required minimal vitest version ([3f8c817](https://github.com/vitest-dev/vscode/commit/3f8c817fbd28be8ddbfeadcb8c9109e81b937d1a))

### [0.2.15](https://github.com/vitest-dev/vscode/compare/v0.2.14...v0.2.15) (2022-06-19)


### Bug Fixes

* windows path issue & improve error message ([8e2a3db](https://github.com/vitest-dev/vscode/commit/8e2a3db9963ae0999d5abf1e449dd42bd2a8710b))

### [0.2.14](https://github.com/vitest-dev/vscode/compare/v0.2.13...v0.2.14) (2022-06-18)


### Features

* use --api to get result from test run ([8e31504](https://github.com/vitest-dev/vscode/commit/8e31504db788db4ef5052dec49a1811e1ba86bf3))


### Bug Fixes

* trivial error ([7cb5a87](https://github.com/vitest-dev/vscode/commit/7cb5a8743137517b730e46b2069b11e6b1242924))

### [0.2.13](https://github.com/vitest-dev/vscode/compare/v0.2.12...v0.2.13) (2022-06-18)


### Features

* add multi-root workspace run/debug support ([27951ad](https://github.com/vitest-dev/vscode/commit/27951ad148b29996d6a7b3e7e005bd235b86206f))


### Bug Fixes

* add log & fix potential error cause [#44](https://github.com/vitest-dev/vscode/issues/44) ([080b5b8](https://github.com/vitest-dev/vscode/commit/080b5b86c3d7e3137dbe26034a72ec6e06a69d90))
* consider workspace folder with no package.json not vitest env ([be4d4c3](https://github.com/vitest-dev/vscode/commit/be4d4c34beba029058bb869459f642fb8d94acc1))
* loop over workspace folders for debugging ([690a880](https://github.com/vitest-dev/vscode/commit/690a880c4060009663029f874915121d1add8762))
* loop to filter w/ async ([a63778f](https://github.com/vitest-dev/vscode/commit/a63778fdc246d00635fe11be6f3e1d53d2a89a2c))
* sequentially debug separate workspace folders ([2239de7](https://github.com/vitest-dev/vscode/commit/2239de74f4db6466af2cd54239a5bf696858e877))
* use specific workspace folder's vitest exe ([da560fc](https://github.com/vitest-dev/vscode/commit/da560fcedead5012fe752770bd37ed4d6c0688be))

### [0.2.12](https://github.com/vitest-dev/vscode/compare/v0.2.11...v0.2.12) (2022-05-31)


### Bug Fixes

* udpate test error message ([4b89bb3](https://github.com/vitest-dev/vscode/commit/4b89bb359f2466c66991ab7a3065be3284a4f606))

### [0.2.11](https://github.com/vitest-dev/vscode/compare/v0.2.10...v0.2.11) (2022-05-23)


### Features

* show diff in watch mode ([3e5a213](https://github.com/vitest-dev/vscode/commit/3e5a213fab6b827616380e13df11745b5a554472))
* show error on the line it failed in watch mode [#37](https://github.com/vitest-dev/vscode/issues/37) ([793e2fc](https://github.com/vitest-dev/vscode/commit/793e2fc71b13ffd85e993e44628cffda4acb3895))

### [0.2.10](https://github.com/vitest-dev/vscode/compare/v0.2.9...v0.2.10) (2022-05-20)


### Bug Fixes

* runIf().concurrent [#36](https://github.com/vitest-dev/vscode/issues/36) ([e4c0dfe](https://github.com/vitest-dev/vscode/commit/e4c0dfef30fe0fcbea298fce4a87897248ae972b))

### [0.2.9](https://github.com/vitest-dev/vscode/compare/v0.2.8...v0.2.9) (2022-05-18)

### [0.2.8](https://github.com/vitest-dev/vscode/compare/v0.2.7...v0.2.8) (2022-05-18)


### Bug Fixes

* use custom path when getVitestVersion ([3ebb2f0](https://github.com/vitest-dev/vscode/commit/3ebb2f099b9575fb9f5670321eb594e003103a4d))

### [0.2.7](https://github.com/vitest-dev/vscode/compare/v0.2.6...v0.2.7) (2022-05-18)


### Bug Fixes

* tests running state in watch mode ([4b36b31](https://github.com/vitest-dev/vscode/commit/4b36b3135036a07aee7f8a211b8988015a41b8f2))

### [0.2.6](https://github.com/vitest-dev/vscode/compare/v0.2.5...v0.2.6) (2022-05-18)


### Bug Fixes

* potential extension activation error ([e5cdae5](https://github.com/vitest-dev/vscode/commit/e5cdae59f1dd3d1f8dddd71e53a0e165275ae9fc))

### [0.2.5](https://github.com/vitest-dev/vscode/compare/v0.2.4...v0.2.5) (2022-05-18)


### Bug Fixes

* fix potential failed issue ([edba084](https://github.com/vitest-dev/vscode/commit/edba0841b75afb82d2b21e72f9225a9b842bc6e6))

### [0.2.4](https://github.com/vitest-dev/vscode/compare/v0.2.3...v0.2.4) (2022-05-17)


### Bug Fixes

* add duration to failed tests ([923ea3f](https://github.com/vitest-dev/vscode/commit/923ea3f7df8cd074b774d4466075ac4ad770a09b))
* dispose state after turning off watch mode ([a89e61b](https://github.com/vitest-dev/vscode/commit/a89e61b149a96907a0f2f96c295c0a5624e2216f))
* use current available port for watch mode ([761b9d4](https://github.com/vitest-dev/vscode/commit/761b9d42972e9d503ba995029e28dad2296d77dd))

### [0.2.3](https://github.com/vitest-dev/vscode/compare/v0.2.2...v0.2.3) (2022-05-17)


### Bug Fixes

* filter color char from testing output ([730ae97](https://github.com/vitest-dev/vscode/commit/730ae971a3b8c3e09bc01edfd7822ee5b968a718)), closes [#34](https://github.com/vitest-dev/vscode/issues/34)
* turn off auto error peek in watch mode ([0447fee](https://github.com/vitest-dev/vscode/commit/0447fee541e9eea4c84b44185df5aaf312556e12))

### [0.2.2](https://github.com/vitest-dev/vscode/compare/v0.2.1...v0.2.2) (2022-05-16)

### [0.2.1](https://github.com/vitest-dev/vscode/compare/v0.2.0...v0.2.1) (2022-05-16)


### Features

* add toggle watch mode to command palette ([7b17988](https://github.com/vitest-dev/vscode/commit/7b179886a873782bb437f5588b6343e5c06b5cab))

## [0.2.0](https://github.com/vitest-dev/vscode/compare/v0.1.27...v0.2.0) (2022-05-16)


### Features

* add fuzzy match for tests ([ce91117](https://github.com/vitest-dev/vscode/commit/ce911178d1d567de3a32f0818f59e00bab2be3dc))
* add watch mode run profile ([4ce6163](https://github.com/vitest-dev/vscode/commit/4ce6163dbb06909eaf2ddb4868a40694e74b1624))
* add watcher ([6a28047](https://github.com/vitest-dev/vscode/commit/6a2804737f30744ec122dd572ef2a2fdc0781843))
* introducing status bar item ([2ad2440](https://github.com/vitest-dev/vscode/commit/2ad2440ce9f20678d94984ed182c7b28233c1b21))
* watcher works. now ([87071ee](https://github.com/vitest-dev/vscode/commit/87071ee518b2c8416642f56cca96eacca4ebfe3a))


### Bug Fixes

* fix spawn cmd ([296f2da](https://github.com/vitest-dev/vscode/commit/296f2da1fa61985f05b0fef612e5c15622e1b65a))
* fix spawn cmd ([25f1dc8](https://github.com/vitest-dev/vscode/commit/25f1dc81ccf7293b691bc3970193e0d37d73fcd5))
* make test run more visible ([3e7d37d](https://github.com/vitest-dev/vscode/commit/3e7d37da29dca8e7c04a9d52766402d133fbf032))
* remove debounce to avoid watch mode error ([b7fbd85](https://github.com/vitest-dev/vscode/commit/b7fbd85000f1982b43081bd90b433db530035829))

### [0.1.27](https://github.com/vitest-dev/vscode/compare/v0.1.26...v0.1.27) (2022-05-08)


### Bug Fixes

* priority on win ([93a6112](https://github.com/vitest-dev/vscode/commit/93a611242e37298d0e7b911b804062ae7f89b6e8))
* use .bin/vitest by default ([852cb41](https://github.com/vitest-dev/vscode/commit/852cb41c4ae465734a5dbf14ce2aef0fc7600238))

### [0.1.26](https://github.com/vitest-dev/vscode/compare/v0.1.25...v0.1.26) (2022-05-08)

### [0.1.25](https://github.com/vitest-dev/vscode/compare/v0.1.24...v0.1.25) (2022-05-08)


### Bug Fixes

* replace spawn with fork in some cases ([b0e36f9](https://github.com/vitest-dev/vscode/commit/b0e36f9895fffeabce3dd841bf111753b13b57f9))

### [0.1.24](https://github.com/vitest-dev/vscode/compare/v0.1.23...v0.1.24) (2022-05-06)


### Bug Fixes

* get vitest version on linux ([5735ceb](https://github.com/vitest-dev/vscode/commit/5735ceb4a25e899cda55ccc639491fdde14c6eae))

### [0.1.23](https://github.com/vitest-dev/vscode/compare/v0.1.22...v0.1.23) (2022-05-01)


### Bug Fixes

* use decorator-legacy on ts file ([c04d4b9](https://github.com/vitest-dev/vscode/commit/c04d4b98c0e23bae765d9f447f43f076cb04406a))

### [0.1.22](https://github.com/vitest-dev/vscode/compare/v0.1.21...v0.1.22) (2022-04-29)

### Features

- update snapshot from contextmenu
  ([#28](https://github.com/vitest-dev/vscode/issues/28))
  ([9228ecf](https://github.com/vitest-dev/vscode/commit/9228ecf4e73ec179baf9bddeed21b55f0b659524))

### Bug Fixes

- filter ANSI color in the outpu
  ([816be56](https://github.com/vitest-dev/vscode/commit/816be56fd82ff2c346d7b0bf30d4ff9e960329e6)),
  closes [#19](https://github.com/vitest-dev/vscode/issues/19)

### [0.1.21](https://github.com/vitest-dev/vscode/compare/v0.1.20...v0.1.21) (2022-04-28)

### Bug Fixes

- add logging for child.stderr
  [#20](https://github.com/vitest-dev/vscode/issues/20)
  ([75d240f](https://github.com/vitest-dev/vscode/commit/75d240f90a9853b82b04c3f50e691da9cd5875de))
- use `npx vitest` as default vitest command
  ([d4d4f70](https://github.com/vitest-dev/vscode/commit/d4d4f70ac97657948daad4af0d4e119cf5220d0d))

### [0.1.20](https://github.com/vitest-dev/vscode/compare/v0.1.19...v0.1.20) (2022-04-27)

### Bug Fixes

- File path corrections for Windows
  ([#24](https://github.com/vitest-dev/vscode/issues/24))
  ([66ca70f](https://github.com/vitest-dev/vscode/commit/66ca70f3894a61a5c2759e78f0ba552f6cebdea7))

### [0.1.19](https://github.com/vitest-dev/vscode/compare/v0.1.18...v0.1.19) (2022-04-23)

### Bug Fixes

- debugging on windows ([#23](https://github.com/vitest-dev/vscode/issues/23))
  ([36fea6d](https://github.com/vitest-dev/vscode/commit/36fea6d63dc43989bee945faa6840186f648fe05))

### [0.1.18](https://github.com/vitest-dev/vscode/compare/v0.1.17...v0.1.18) (2022-04-22)

### [0.1.17](https://github.com/vitest-dev/vscode/compare/v0.1.16...v0.1.17) (2022-04-19)

### Bug Fixes

- use 'node vitest' as vitest command on windows
  ([e3df7da](https://github.com/vitest-dev/vscode/commit/e3df7dac2dfef6d9c75e79426b1d177ca6479511))

### [0.1.16](https://github.com/vitest-dev/vscode/compare/v0.1.15...v0.1.16) (2022-04-06)

### Bug Fixes

- linebreak on win
  ([abaeb04](https://github.com/vitest-dev/vscode/commit/abaeb049fc2ebede7e293c9502dcde2127f53f28))

### [0.1.15](https://github.com/vitest-dev/vscode/compare/v0.1.14...v0.1.15) (2022-03-31)

### Bug Fixes

- replace pnpm with yarn
  ([7e59a60](https://github.com/vitest-dev/vscode/commit/7e59a602b77baad7d0d00369667c27bd5487f76f))

### [0.1.14](https://github.com/vitest-dev/vscode/compare/v1.0.1...v0.1.14) (2022-03-30)

### Bug Fixes

- force spawn to use powershell on windows and fixed drive case match
  ([04538c6](https://github.com/vitest-dev/vscode/commit/04538c69c86ba702d40e0861dc283bcaa0f55cc8))

### [0.1.13](https://github.com/vitest-dev/vscode/compare/v0.1.12...v0.1.13) (2022-03-29)

### Bug Fixes

- remove redundant line break
  ([0c992af](https://github.com/vitest-dev/vscode/commit/0c992af3adb8f238664225cf616c1aa97fce85b7))

### [0.1.12](https://github.com/vitest-dev/vscode/compare/v0.1.11...v0.1.12) (2022-03-29)

### Bug Fixes

- debug & run tests on win
  ([27ec1a9](https://github.com/vitest-dev/vscode/commit/27ec1a95e5b336b362c6f20721eac2b2fa1979c9))

### [0.1.11](https://github.com/vitest-dev/vscode/compare/v0.1.10...v0.1.11) (2022-03-29)

### Bug Fixes

- adapt vitest 0.8.0 json format
  ([7326dc2](https://github.com/vitest-dev/vscode/commit/7326dc2c04b78edc8c5c82b8473dfdc360d2da03))

### [0.1.10](https://github.com/vitest-dev/vscode/compare/v0.1.9...v0.1.10) (2022-03-25)

### Features

- getting test result from debug
  ([78aaa4b](https://github.com/vitest-dev/vscode/commit/78aaa4b689ddce3edf6700a20a22c1892a61e838))

### [0.1.9](https://github.com/vitest-dev/vscode/compare/v0.1.8...v0.1.9) (2022-03-23)

### Features

- add directory prefix if needed
  ([23f40d1](https://github.com/vitest-dev/vscode/commit/23f40d16408e0c82fed909bfc470aae32aa30681))

### Bug Fixes

- detect vitest env by vitest config file
  ([d584b28](https://github.com/vitest-dev/vscode/commit/d584b28b4a976a169dd04463ae96f4500b3dc077))
- filter tests correctly
  ([4f57d6e](https://github.com/vitest-dev/vscode/commit/4f57d6e21c70a2fc6501989c31642e689a9486f4))

### [0.1.8](https://github.com/vitest-dev/vscode/compare/v0.1.7...v0.1.8) (2022-03-23)

### Bug Fixes

- build error
  ([95d60c6](https://github.com/vitest-dev/vscode/commit/95d60c69ccf1c5568c5fd164856a6ec04be7f894))

### [0.1.7](https://github.com/vitest-dev/vscode/compare/v0.1.6...v0.1.7) (2022-03-23)

### Bug Fixes

- compile error
  ([ad95334](https://github.com/vitest-dev/vscode/commit/ad953342b2c089a0ef7be66290ba04fe9006f587))

### [0.1.6](https://github.com/vitest-dev/vscode/compare/v0.1.5...v0.1.6) (2022-03-23)

### Features

- custom config
  ([05b06b4](https://github.com/vitest-dev/vscode/commit/05b06b49ef3dea401bb5e4be1ab508051dc36b5e))

### [0.1.5](https://github.com/vitest-dev/vscode/compare/v0.1.4...v0.1.5) (2022-03-23)

### Bug Fixes

- refine error handling and err msg
  ([febdc42](https://github.com/vitest-dev/vscode/commit/febdc42caf10617cf2da52a7b46414f620144474))

### [0.1.4](https://github.com/vitest-dev/vscode/compare/v0.1.3...v0.1.4) (2022-03-22)

### Bug Fixes

- should use test name as id instead of index
  ([e7622dd](https://github.com/vitest-dev/vscode/commit/e7622dd3eced06eb538940c390a15a75816114b5))

### [0.1.3](https://github.com/vitest-dev/vscode/compare/v0.1.2...v0.1.3) (2022-03-22)

### Bug Fixes

- audit issues
  ([ae7cc44](https://github.com/vitest-dev/vscode/commit/ae7cc4461f05ea5f29e279613aafc7f5635b4789))
- make error more informative
  ([5ced470](https://github.com/vitest-dev/vscode/commit/5ced4707f6011637430e4b9320e6951cd2615582))

### [0.1.2](https://github.com/vitest-dev/vscode/compare/v0.1.1...v0.1.2) (2022-03-22)

### Features

- run all tests in one go
  ([ac86db0](https://github.com/vitest-dev/vscode/commit/ac86db09bc1b0f285d1000dfa3b12eee308f2146))

### 0.1.1 (2022-03-22)

### Features

- add test runtime
  ([3d6e1ab](https://github.com/vitest-dev/vscode/commit/3d6e1ab1d96c7182f788355236e1bb953dd2e344))
- discover tests
  ([c2dfcbf](https://github.com/vitest-dev/vscode/commit/c2dfcbf5ccab5dd7e6aeb2003564e4046730ed44))
- forward output
  ([98b0820](https://github.com/vitest-dev/vscode/commit/98b082034366fe261daf1f88c067153e02340727))
- run tests
  ([94c6161](https://github.com/vitest-dev/vscode/commit/94c616131c50662998e194a155633576075499c5))
- support debug
  ([50aafca](https://github.com/vitest-dev/vscode/commit/50aafca9eda32aad5d058cf947f9e48d1ab1c57a))

### Bug Fixes

- cannot get test result correctly
  ([3847bd4](https://github.com/vitest-dev/vscode/commit/3847bd4f49e14d011a4e7a6679c69cc4e2b03441))
- conditionally activate extension
  ([0b18649](https://github.com/vitest-dev/vscode/commit/0b186491372aec38e1e6f9df2495bf98373aa81e))
- end run after all tests settled
  ([f538b2b](https://github.com/vitest-dev/vscode/commit/f538b2b2900313bd372708302f61c87a90adc8fc))
- launch script
  ([263ef2c](https://github.com/vitest-dev/vscode/commit/263ef2caaf4d59487f89aad53669364307cb90ae))
- load test in visible text editors
  ([c659196](https://github.com/vitest-dev/vscode/commit/c659196e4f1b6ba04893196eafc924adca3f8bf3))
- run test with full name
  ([4269efc](https://github.com/vitest-dev/vscode/commit/4269efc2efd8ee35d4ea7a89b47a41dffd92611b))
- test registry bug
  ([d041868](https://github.com/vitest-dev/vscode/commit/d041868550c42ae2c65a9e4577d0c7875a51b4d0))
- use testCase index to retrieve testItem
  ([89daff4](https://github.com/vitest-dev/vscode/commit/89daff47638091f035a4a455d388b224a8a3d22a))
