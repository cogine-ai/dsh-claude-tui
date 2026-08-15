# v0.1.0 Release Hardening

- Status: **Released**
- Owner: maintainers
- Confidence: high
- Package: [`dsh-claude-tui@0.1.0`](https://www.npmjs.com/package/dsh-claude-tui/v/0.1.0)
- Approved: 2026-08-15
- Published: 2026-08-15

## Decision

`v0.1.0` passed every gate in this document and was published to npm on 2026-08-15. The milestone includes a one-command launcher, so a user with a supported Node.js version can install and enter the TUI with:

```sh
npx dsh-claude-tui
```

No separately installed `dsh` command, repository checkout, pnpm installation, or manual profile setup may be required. Provider credentials are still required before a real model request.

This milestone also includes the bounded model/provider surfaces approved for first-run usability: the Claude-shaped interaction is [documented separately](./model-provider-interactions.md), while all catalog, default, effort, and credential semantics remain DSH-owned. Further visual surfaces and interaction features remain deferred until after `v0.1.0`. The release sequence remains:

```text
Release hardening ✓ -> merge to main ✓ -> publish from the exact merged main commit ✓ -> verify registry metadata and a clean npx launch ✓ -> GitHub Release/GIF -> public launch -> feedback-led iteration
```

## Release gates

### 1. Publishable package

- Add a lifecycle build such as `prepack` so a clean checkout produces `lib/index.js`, `lib/startup.js`, and their declaration files.
- Complete the npm metadata: `repository`, `homepage`, `bugs`, and `keywords`.
- Build and pack from a clean Git archive, not from a worktree that already contains generated `lib` files.
- Inspect the tarball and assert that it contains the runtime files, type declarations, launcher, `cordis.patch.yml`, README files, disclaimer, and license.
- Install and execute the packed tarball before any registry publication.

### 2. One-command launcher

The package must expose an executable through `package.json#bin`. That launcher must:

- carry a compatible, version-pinned DeepSeek Harness CLI as a runtime dependency;
- publish a production `npm-shrinkwrap.json` so `npx` resolves the qualified transitive tree instead of accepting newly published dependency drift;
- make `npx dsh-claude-tui` reach the Claude-style TUI on first run;
- initialize the managed `claude-tui` profile when it is absent;
- on later runs, reconcile only the launcher-owned plugin registration to the package version currently executing;
- preserve credentials, Sessions, user overlays, and unrelated profile entries;
- fail with an actionable message instead of overwriting an existing profile when safe reconciliation is impossible;
- forward CLI arguments such as `--resume` and `--model`, the current working directory, environment, interactive stdio, exit codes, and termination signals;
- apply bundle-required defaults without overriding an explicit user environment;
- keep `--help` and `--version` side-effect free;
- never independently copy, print, or persist provider credentials; only an explicit masked TUI action may pass a value to DSH's credential service;
- preserve prompt drafts across model/provider overlays and mask API-key input from terminal output and Session history;
- read provider/model/effort/default/credential state from the corresponding DSH services instead of shipping a fixed catalog;
- never perform an independent self-update or mutate unrelated Harness plugins.

### 3. Packed end-to-end qualification

Run the following checks with no globally installed `dsh` and with a fresh temporary `DSH_HOME`:

1. Execute the tarball through its published bin and prove that the first run creates the required managed state and opens the TUI.
2. Complete one deterministic local-mock tool turn and exit cleanly.
3. Run the same package a second time and prove that setup is idempotent.
4. Preserve a user-owned marker/config entry across the second run.
5. Resume the created Session through `npx dsh-claude-tui --resume`.
6. Verify argument forwarding, non-zero child exit propagation, signal handling, and terminal restoration.
7. Exercise supported Node.js lines `22.19+` and `24+`; record the qualified operating systems and terminal emulators.

The existing Gate 3 runtime evidence remains the semantic baseline: local deterministic scenarios passed `8/8`, real DeepSeek scenarios passed `2/2`, and the full suite passed `42/42` at commit `5957907`.

### 4. Repository and publication readiness

- `pnpm check`, the clean-pack contract, and packed end-to-end qualification must all pass on the release commit.
- The release artifact must pass a credential and unexpected-file scan.
- Confirm npm package ownership, authentication, and 2FA before publishing.
- Keep the active repository CI workflow enabled and require a successful release-candidate run before publication.
- Inspect the staged package before final approval. Publishing, tagging, GitHub Release creation, and promotional assets happen only after this milestone is complete.

## Dependencies and risks

| Item | Release implication |
| --- | --- |
| Harness CLI compatibility | Pin the CLI used by the launcher and qualify upgrades instead of accepting an unbounded range. |
| Existing Harness installs | Ignore global executables, preserve unrelated `$DSH_HOME` state, reject an unowned `claude-tui` profile, and fail loud on pre-release on-disk format mismatches; cross-version migration is not owned by this launcher. Do not concurrently run different Harness versions against one `$DSH_HOME`, because Harness owns and may reconcile shared profile-module fallbacks. |
| Registry dependency drift | Publish the qualified npm production tree. The temporary direct pin on `@aws-sdk/credential-provider-node@3.972.79` avoids upstream `3.972.80`, whose published dependency range currently points to a nonexistent package version; remove the pin only after a clean npm install and packed E2E both pass without it. |
| Native install surface | The npm package is small, but its pinned Harness closure installs hundreds of packages and runs reviewed native setup for `node-pty`, `koffi`, and Harness' subprocess helper. Qualify cold installs on every supported OS and keep the production audit clean. |
| Profile ownership | Reconciliation must distinguish launcher-owned state from user-owned customization. |
| `npx` cache and offline behavior | Errors must identify whether package resolution, Harness setup, or provider access failed. |
| npm authentication and 2FA | Publication succeeded under the authenticated package owner; `latest` resolves to `0.1.0`. |
| CI activation | The release candidate passed the full Ubuntu matrix on Node.js `22.19.0`, `22.22.3`, `24.0.0`, and `24.14.0`. |

## Completion rule

Release Hardening was approved only after the release commit passed every gate above from a clean environment and the exact packed artifact passed local-mock, process-boundary, Session-resume, and real DeepSeek qualification. Passing source-level tests alone was insufficient.

The public registry reports `gitHead` `21679afe9a65bef44d2ccc11aa2ecca52215a218`, matching the exact merged `main` commit. A post-publication run with a fresh npm cache and isolated `DSH_HOME` rendered the TUI, created the managed profile, did not echo the supplied credential, and exited cleanly.

## Roadmap change log

- Before: release packaging beyond checkout installation was an undifferentiated future item.
- After: `v0.1.0 Release Hardening` made `npx dsh-claude-tui` a blocking release promise with explicit first-run, repeat-run, safety, and packed-artifact gates.
- Released: the pinned artifact passed the four-version CI matrix, production dependency audit, publish dry-run, packed real-API smoke, registry metadata verification, and clean public-`npx` launch required for npm publication.
