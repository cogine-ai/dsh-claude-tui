# DeepSeek Harness 0.1.2-rc.1 adaptation

This source change follows npm's `@deepseek-ai/dsh@0.1.2-rc.1`, released from upstream commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. The published TUI remains `0.1.5` with DSH `0.1.1-rc.2`; this document does not announce a new npm release.

## Runtime changes

- The bundled graph is pinned to `0.1.2-rc.1`; eligible external runtimes must satisfy `>=0.1.2-rc.1 <0.1.3` and pass the temporary-Home behavioral probe. Older runtimes and the `0.1.3` alpha line are rejected before probing.
- Session replay reads one `snapshotEvents()` snapshot for transcript, prompt history, and plan state. The probe appends a user event, verifies `seq`, `eventAt()` and snapshot readback, and flushes before disposing the Agent.
- User questions register on the Agent-scoped `user-questions/request` waterfall. Requests for another Agent continue to the next answerer; terminal shutdown cancels pending questions and removes the listener. Tests use the actual upstream `UserQuestionService`.
- Provider configuration uses the current string-based settings namespace API. Test fixtures use the renamed `ToolCallId`, branded `SessionSeq`, and explicit Session headers.
- Upstream no longer exports `isTokenDelta`. The TUI preserves its timing predicate locally: nonempty text, reasoning, or tool arguments, or a tool-name field, start first-token timing; framing and usage records do not.
- The runtime's tools modes are `native`, `ptc`, and `both`. The default is `ptc`; `DSH_TOOLS_MODE=code` remains a launcher/bundle input alias. The welcome panel reports the canonical mode.
- Cordis `4.0.2`, loader `1.0.3`, group `1.0.2`, and Schemastery `3.18.2` satisfy the target release's peer requirements. The npm production shrinkwrap is regenerated and checked for one DSH version line. Eight required runtime peers are now explicit dependencies so cold installs also work with `--legacy-peer-deps`: Session persistence, Session query, settings, jobs, hook protocol, SDK protocol, time utilities, and workspace-path utilities.
- Sharp remains at the existing `0.35.3` image-processing baseline as an explicit dependency. In a cold local-tarball install, npm `10.9.8` resolved the transitive `^0.35.3` range to `0.35.4` despite the included shrinkwrap. The direct pin keeps the installed image runtime at the intended baseline and retains the existing narrow optional-package exception in the artifact gate.

The existing image composer, attachment storage, `/plan` toggle, structured questions, approvals, model/provider menus, and Session resume remain in scope. Upstream Web Preview, Inspector, browser file upload, and other Web features are not added to this TUI by upgrading the runtime.

## Official documentation

The [official mirror](./upstream/dsh/README.md) contains 1,332 original upstream files: bilingual guides, architecture and subsystem documentation, API/configuration catalogs, package READMEs, local guide images, translation metadata, and license notices. [MANIFEST.json](./upstream/dsh/snapshot/MANIFEST.json) records the release tag, commit, Git blob IDs, SHA-256 hashes, and file sizes.

`corepack pnpm docs:dsh:sync` follows the exact runtime pin. `corepack pnpm docs:dsh:check` verifies the snapshot offline and runs through `pnpm check` in CI. Adding `--source /path/to/deepseek-harness` compares the complete selected set against the release's committed Git blobs. Modified, missing, or extra snapshot files prevent replacement; maintainer notes stay outside `snapshot/`. The mirror is excluded from the npm tarball. Git preserves its original line endings and marks these generated upstream copies for collapsed PR review.

Replacement snapshots are fully verified before switching directories. A regression test proves that a new release missing its required license leaves the previous mirror intact. This fixes the replacement order found during final self-review.

## Validation

Validated on 2026-09-07 on macOS arm64 with Node.js `22.22.3`, npm `10.9.8`, and pnpm `11.20.0`:

| Check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | Passed with the final dependency pins. |
| `corepack pnpm peers check` | No peer dependency issues. |
| `corepack pnpm check` | Fresh self-review run: TypeScript, build, documentation integrity, and all 13 test files passed: 153 tests passed, 1 opt-in system-clipboard test skipped. |
| `corepack pnpm test:bundle:default` | Fresh self-review run with ordinary npm peer resolution: 10 installed-artifact tests passed, 1 opt-in system-clipboard test skipped; total gate duration 140 seconds. |
| `corepack pnpm docs:dsh:sync` | Downloaded the exact official release tag and produced a snapshot of that tagged source. |
| `corepack pnpm docs:dsh:check --source /path/to/deepseek-harness` | All 1,332 selected upstream files and their metadata match the release's Git blobs. |
| `git diff --cached --check -- . ':!docs/upstream/dsh/snapshot/**'` | Maintained files pass. The official snapshot preserves one upstream trailing space in `vendor/cosmokit/README.md`; all 1,332 staged upstream blobs match their original Git IDs. |

The installed-artifact gate uses a fresh npm cache. It checks the published file set, required DeepSeek peers, the full `npm ls --all` tree, and the loaded Sharp version. Installed PTY tests cover a local mock model's real PTC tool turn, Session resume, the external-runtime path, and macOS Shift+Tab plan state and resume. Headless terminal tests cover model/provider menus, questions, approvals, and image-composer failure and cancellation paths. No production model request was sent. The existing narrowly named optional Sharp residue exception remains; missing, invalid, or conflicting runtime dependencies fail the gate.

Work started from clean `origin/main` at `a2c251f4be04ea19e12fc2150620c669d05afae9` in branch `cliq/dsh-0.1.2-rc.1-docs`. Before adaptation, baseline typechecking, application/startup tests, and all 8 real-runtime probe tests passed after building the baseline. This is a source adaptation with local evidence, not an npm publication or a remote CI result.

## Data and platform limits

The target release removes the optional SQLite Session persistence backend. Export data stored by that backend with the older Harness before upgrading; SQLite query/index storage is a separate service. This adapter does not implement a SQLite exporter, downgrade support, or a custom Session migration. Use isolated Homes for cross-version testing.

The repository's CI matrix targets Ubuntu with Node `22.19.0`, `22.22.3`, `24.0.0`, and `24.14.0`; a local macOS run does not establish that matrix's status. Windows remains unqualified until Windows CI and packed-TUI/ConPTY testing are recorded. Production-provider and real system-clipboard checks require their separate opt-in gates.
