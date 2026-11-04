# DeepSeek Harness 0.2.2-rc.1 adaptation / 适配记录

Target: unreleased TUI `0.1.10`, using `dsh-v0.2.2-rc.1` at upstream commit
`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`. Compared with the previous pin
`dsh-v0.2.1-rc.2` (`687f282e8625c6b8d11ff58211a90524be2e4317`).
This work does not publish an npm package or a GitHub release.

本次适配从 `0.2.1-rc.2` 直接升级到 `0.2.2-rc.1`；源码审查、实际测试与发布分别记录。
此前版本的验证结果保留在原适配文档，不作为本轮通过证据。

## Confirmed changes / 已确认变化

| Surface | Upstream contract and adaptation |
| --- | --- |
| Node | Upstream requires `>=24.9.0`. Match manifest, early launcher rejection, contributor instructions, and CI. Node 22 and Node 24 below 24.9 are excluded before discovery or Home writes. |
| Cordis | Use target Cordis `4.1.0`, Loader `1.1.0`, Group `1.1.0`, Schemastery `3.19.0`. Keep Include-local settlement so startup does not wait on its own ancestor. Include owns runtime persistence; the launcher still reconciles only its owned profile. |
| Model selection | Remove `ModelSelectionRef`. Read `agent.model.current()` and persist through `select()`. Keep `installModelSelection(ctx)` for switch notices. Resume preserves recorded and unused choices. Explicit invocation routes preserve saved explicit effort only for the same route. DSH captures selection before step preparation and retains it across retries. |
| Executors | `tools.mode` is removed. Select exactly one `tool-executor-native` or `tool-executor-ptc` row. The TUI continues to map its validated `DSH_TOOLS_MODE` option, defaults to PTC, accepts `code` as an alias, and rejects `both`. Upstream profiles no longer consume that variable themselves. |
| Projections | Agent, subagent, and approval require the projection registry and asynchronous activation. Compose the real registry in service tests and use owning services. Remote projection-frame changes do not affect this local Agent client. |
| Sessions | Format remains V4; added `model/selection` records persist unused choices. Store writes require completed announcement. Agent setup remains the correct place to select models. Ordinary forks are independent; the picker already filters by `origin`, not parent metadata. New parentless forks can fail in older V4 readers: no downgrade guarantee. |
| Tools | Conditional tools are admitted per step. `exit_plan_mode` is absent until plan mode has been entered. Tests use the actual executor and admitted tool declarations rather than bypassing them. |
| Attachments | Direct `attachments.saveImages/readImage` contracts remain applicable. Remote complete-reference reads, mobile uploads, and Web UI changes do not establish additional TUI capabilities. |
| Filesystem | The exact target base disables the optional observation policy and sets `tool-fs.applyPatch: false`. Follow that shipped composition; sandbox and review remain upstream-owned. No local policy override is added. |
| Subagents | Managed activation receipts remain distinct from completion. If the child last sent its parent a message, the settlement intentionally omits duplicate closing text; otherwise its final text remains. Installed tests cover both paths. Shared control-tool registration and durable roster identity remain applicable. |
| Credentials and catalog | Retain interactive stored credential precedence and owner-reported writability. DeepSeek catalogs now refresh automatically; the TUI listens for adapter updates. Do not copy headless authentication restrictions. |

## Sources / 来源

All source links are pinned to the inspected commit:

- [Node floor](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.md), [CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/apps/cli/package.json).
- [Model-selection migration](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-alpha.4/session-model-selection/guide.md), [implementation](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/core/agent/src/model-selection.ts), [switch compaction](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-alpha.4/model-switch-compaction/guide.md).
- [Executors](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/tool-executor-plugins/guide.md), [conditional tools](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/conditional-tools/guide.md), [exact base composition](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/bundle/base/cordis.patch.yml).
- [Projection handles](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/session-projection-handles/guide.md), [store writes](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/session-store-writes/guide.md), [independent forks](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.3/independent-session-forks/guide.md).
- [Loader changes](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/guide.md), [catalog refresh](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.4/model-listing-refresh/guide.md), [Auto shutdown](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/docs/upgrade-guide/v0.2.1-rc.2/auto-review-shutdown/guide.md).

## Verification / 验证

Executed on macOS arm64 on 2026-11-04 (Asia/Taipei):

| Gate | Result |
| --- | --- |
| Exact-tag source and documentation | Passed: complete byte/hash inventory of 2,373 original files, including comparison with the fetched official tag. |
| Node `24.22.1` complete `CI=true corepack pnpm check` | Passed: **17 files, 238 passed, 1 skipped** (239 total), exit 0, **247.95 seconds**. Final corrected dependency graph; retained npm download cache. |
| Node `24.9.0` ordinary npm, fresh cache | Passed before the explicit OpenTelemetry root pin: **19 passed, 1 skipped** (20 total), **749.61 seconds**. All packed runtime paths and the full npm tree passed with ordinary peer resolution. |
| Node `24.9.0` final corrected ordinary npm graph | **Passed: 19 passed, 1 skipped** (20 total), exit 0, **45.59 seconds**. Final corrected package, retained cache with npm offline preference. |
| Frozen workspace install | Passed: lockfile unchanged, dependency resolution skipped, 428 ms. |
| Version and provenance | TUI `0.1.10`, all 324 DSH package entries in the production shrinkwrap pinned to `0.2.2-rc.1`; portable lock paths and manifest equality checked. |
| Terminal and launcher | Passed: existing visual/semantic reference anchors, tools-mode normalization/rejection, unsupported Node rejection before Home writes, system/bundled selection, explicit/default Home ownership, repeat launch, exit and signal handling. |
| Packed PTC turn, attachments, shutdown and resume | Passed through actual DSH, local authenticated Messages/Files fixtures, sandboxed Node PTC, and the installed tarball. |
| Packed native subagents | Passed both with a parent message (duplicate closing text intentionally omitted) and without a parent message (full closing text retained); durable catalog, delivery, settlement, and tool schemas checked. |
| Durable model selection | Passed real projection tests and packed PTY create/resume/explicit override/resume before any model request; the fixture server recorded no model requests. Same-route effort retention and different-route omission checked. |
| Historical Sessions | Passed installed TUI recovery of `0.1.2-rc.1` V0, `0.1.5-rc.2` V3, `0.2.0-rc.2` V4, and newly generated **published `0.2.1-rc.2` writer** V4 fixtures. Prompt/reply/tool results and original bytes or byte prefixes preserved. |
| MCP | Passed owner-resolved stdio and HTTP registration/pagination, native batch invocation, structured results, cancellation, headers and disposal; optional GenAI SDK v1 bridge also passed. |
| Existing dependency-owner checks | Passed native image processing, Office ZIP64 rejection, URI normalization and AJV integration. The Office repack reproduced byte for byte. |
| Dependency audit | The initial 2026-11-04 result below is superseded by the 2026-11-05 security remediation recorded at the end of this document. |
| Real system clipboard | Optional opt-in test skipped. |
| Production provider/OAuth, Windows ConPTY, Ubuntu CI | Not run in this local adaptation. CI matrix updated to Node `24.9.0` and `24.22.1`; configuration changes do not establish a remote run. |
| Publication | Not performed. |

The first installed dependency-tree check exposed `@opentelemetry/api@1.10.0`
under legacy peer installation, outside the SDK peers' `<1.10.0` range.
The final package explicitly pins `1.9.1`, matching the workspace and every
consuming peer range. The complete corrected run retains the strict `npm ls
--all` check; its failure was fixed rather than ignored. Corrective reruns use
`DSH_CLAUDE_TUI_NPM_CACHE` to retain downloads; default CI still uses a fresh cache.

初次安装包验证发现 OpenTelemetry API `1.10.0` 不符合 SDK peer 范围；最终固定为
`1.9.1`，保留严格依赖树检查。修正后的完整测试通过；冷安装与复用缓存的修正复验分开
记录。真实系统剪贴板为可选跳过项，生产模型、OAuth、Windows 和远端 CI 未执行。

The official documentation snapshot contains **2,373** unmodified upstream
files from this exact tag. It is excluded from npm artifacts.

Use isolated Homes for all cross-version tests. Local Messages/Files and MCP
fixtures exercise real DSH code without production provider requests. Production
model/OAuth requests, Windows ConPTY, and remote GitHub CI are separate coverage;
do not infer their completion from local checks.

## Dependency audit / 依赖审计

Compatible dependency updates retain the existing Office manifest repack and
advance fast-uri to `3.1.9`, qs to `6.16.1`, optional MCP SDK v1 to `1.32.0`,
Hono to `4.13.16`, ip-address to `10.7.5`, body-parser to `2.4.0`,
Vitest to `4.1.12`, and Vite to `8.2.4` in their owning locks/overrides.
The production shrinkwrap uses portable `node_modules/` paths, exact tarball
integrities, and no development dependency graph.

The unmodified target upstream pins three dependencies with advisories; the local repair now replaces these exact manifest pins:

| Root dependency | Upstream pin | Patched release | Audit evidence |
| --- | --- | --- | --- |
| MCP client | `2.2.0` | `2.3.0` | [Cross-origin redirect forwarding](https://github.com/advisories/GHSA-6prh-2h8m-c8cw) |
| undici | `8.11.2` | `8.12.2` | Eight advisories, including [redirect/cache handling](https://github.com/advisories/GHSA-4w7w-5xrc-9h26) and [TLS options](https://github.com/advisories/GHSA-2m5v-pch6-74hx) |
| Zod | `4.4.3` | `4.6.6` | [Oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |

On 2026-11-04, workspace `pnpm audit --json` reported **5 moderate and 5 high
advisories**, all belonging to these three dependency names. The production
`npm audit --omit=dev --json` reported **208 affected package entries** (9
moderate, 199 high), including dependent packages; these are not 208 distinct
vulnerabilities. The production graph contains 677 dependency package entries,
including 324 DSH packages pinned to the exact target. OpenTelemetry API is explicitly pinned to `1.9.1` to satisfy SDK peers. Audit exits nonzero.
This is the initial, pre-remediation result; it does not describe the repaired artifact.

The initial adaptation preserved these upstream pins. The subsequent authorized
repair uses maintained manifest-only repacks because root-only npm overrides in
a consumed dependency do not provide a portable fix. Release remains pending.

已更新本项目原有的可兼容修补依赖，并保留 Office repack。上游精确固定的 MCP client、
undici 与 Zod 仍有公告；上表区分根因公告与 npm 向依赖方传播后的包条目数，不能将功能
测试通过写成安全审计通过。本次没有发布。

## Security remediation / 安全修复（2026-11-05）

The local package now selects MCP client/core `2.3.0`, undici `8.12.2`, and Zod
`4.6.6`. Sixty exact DSH owner manifests are repaired: 57 Zod pins, two undici
pins, and one MCP client pin. All other archive members, modes, licenses, and
DSH package versions remain unchanged. The earlier Office repack is retained.
`scripts/security-repacks.json` and `vendor/security/provenance.json` record
original and repaired integrity plus per-member hashes; the generator reproduces
all 61 archives byte for byte.

The npm artifact bundles the complete 324-package DSH closure, including the 60
repaired owners. Bundling only the repaired owners was insufficient: an external
DSH parent can otherwise load an original owner through npm hoisting. Canonical
DSH archives are verified against `scripts/dsh-bundle.json` before staging;
remaining dependencies stay external under the production shrinkwrap. Required
external entries are also declared at the staged root so npm fetches them
before running bundled DSH install scripts; platform-specific optional entries
remain optional. No newly
uploaded archive or dependency consumer override is required.

Build the local artifact with `corepack pnpm run pack:artifact`. It builds the
TUI, verifies and stages the closure, then uses `npm pack --ignore-scripts
./dist`. Direct source packing is rejected with this command as the remedy.
This avoids pnpm 11.20's recursive bundle traversal into ancestor dependencies,
which produced invalid `package/../node_modules/` entries during qualification.
Installed-artifact tests verify the exact bundled inventory and bytes, strict
`npm ls --all`, and production `npm audit` in addition to runtime behavior.

The [upstream undici security release](https://github.com/nodejs/undici/releases/tag/v8.12.2) lists the eight advisory classes covered below.

Regression tests resolve libraries through their actual DSH owners:

- MCP: authenticated `tools/call` on 307, 308, and same-origin-to-cross-origin
  chains must send no request to the foreign target. Direct and same-origin
  calls, stdio/HTTP discovery, pagination, structured results, cancellation,
  headers, and cleanup remain covered.
- Zod: the actual Agent checkpoint schema rejects 1,000 excess values before
  any element parser runs. Compiled/interpreter arrays, Set, and Map bounds are
  covered, with valid checkpoint, invalid in-range, empty, and overwrite controls.
- undici: mixed-case SRI good/bad digests, excessive response encodings in an
  isolated worker followed by a healthy request, legacy TLS verification callbacks,
  originless redirect/shared-cache poisoning, private redirect isolation, and
  ordinary same-origin caching. Additional bounded tests cover post-connect TLS
  hostname errors in an isolated worker, asynchronous decompress/dump handler
  exceptions, EventSource field/chunk limits, and WebSocket PONG backpressure
  with resumption on drain. Cache tests use dispatcher `request`, ensuring
  the vulnerable interceptor path is exercised rather than Fetch's own redirects.

Original versions reproduced MCP disclosure, Zod's 1,000 element visits, SRI
mismatch acceptance, TLS callback loss, cache poisoning, and worker failure,
plus the TLS socket assertion, uncaught decompression-handler exception,
unbounded EventSource state, and ignored WebSocket PONG backpressure.
These controls distinguish behavioral closure from version-only audit checks.
The TLS and shared-cache cases exercise library boundaries; current DSH
composition does not establish all prerequisites for an application exploit.
TLS renegotiation validation injects Node's post-connect hostname error into
an established HTTP/1 connection; it does not execute an actual certificate-changing
TLS handshake or the HTTP/2 variant. EventSource/WebSocket parser tests use
bounded inputs at the library boundary; they do not assert those APIs are used
by DSH's two HTTP owners. Zod's fix concerns leading size bounds, not arbitrary
unbounded collections.

Publication has not been performed. Production model/OAuth, Windows ConPTY,
Linux CI, and the opt-in real clipboard remain outside this local verification.

### Remediation verification / 修复验证

Executed locally on macOS arm64, 2026-11-05 (Asia/Taipei). All corrective package
installs reuse the recorded npm cache; these results do not claim cold-cache
installation or remote CI coverage.

| Gate | Repaired result |
| --- | --- |
| Syntax/types | `node --check` for packaging/lock scripts and `tsc --noEmit`: passed. |
| Focused regressions | `vitest run tests/dependency-security.spec.ts --no-file-parallelism`: 4 passed; includes all eight undici advisory classes and legitimate controls. |
| Vulnerable controls | Original owner-resolved MCP `2.2.0`, undici `8.11.2`, Zod `4.4.3` reproduce the failures recorded above. No production service was contacted. |
| Node `24.22.1` full gate | `CI=true corepack pnpm check`: **18 files, 249 passed, 1 optional clipboard test skipped**. |
| Node `24.9.0` ordinary npm | Installed tarball suite with default peer resolution: **20 passed, 1 optional clipboard test skipped**. With packed-launcher and external-owner policy cases included: **3 files, 79 passed, 1 skipped**. Includes strict full dependency tree, production audit, all security helpers, PTC/native turns and recovery. |
| Workspace audit | `corepack pnpm audit --json`: **0 advisories**, all severity counters zero. |
| Installed production audit | `npm audit --omit=dev --json`: **0 vulnerabilities**, enforced by the installed artifact suite. |
| Dependency tree | `npm ls --all --json`: passed for both installed consumer modes. |
| Reproducibility | `python3 scripts/repack-security-dependencies.py --check --npm-cache PATH`: all **61** archives and generated provenance match regenerated bytes. |
| Workspace lock | Frozen installation passed with no lock changes. |
| Independent review | One read-only candidate review found no concrete bypass in repaired owner/library boundaries. Subsequent packaging corrections were validated by the parent through actual npm installation and runtime tests. |
| Publication | **Not performed**. |

The repaired results supersede the earlier nonzero audit and pre-remediation
functional counts. Audit success applies to this pinned package graph at the
recorded time, not to unrelated dependencies or future registry advisories.

### External runtime selection / 外部运行时选择

The launcher now checks the actual dependency owners in an external DSH graph
before its existing isolated behavior probe. This closes the default `auto`
selection route that could otherwise prefer an unmodified system DSH over the
repaired bundle. It follows nested owner resolution, not just root copies;
MCP client and core must both qualify. `auto` reports the reason and falls back
to the repaired bundled runtime; explicit `system` fails with an actionable
message. Patched external runtimes retain the same discovery/profile workflow.
The check reads manifests without executing external dependency code or changing
the selected Home. It does not repair a separately installed DSH in place.

Regression coverage includes each affected dependency version, a nested old Zod
copy hidden behind a patched root copy, the real repaired workspace graph, and
packed CLI cases for safe external selection, unsafe automatic fallback, and
unsafe explicit-system rejection. The earlier isolated behavioral probe remains
required after dependency qualification.

A separate real external-DSH probe loading the fully staged TUI also returned
`compatible: true`; positive external reuse is not established solely by fake CLI fixtures.

### PR CI follow-up / CI 跟进（2026-11-05）

The initial Ubuntu run for `97af482` passed the complete Node `24.22.1` gate
(249 passed, one optional clipboard test skipped). Node `24.9.0` passed the
installed-bundle and security checks but failed the packed-launcher setup:
cold artifact preparation took 58.5 seconds against its legacy 30-second hook
budget, leaving all 53 launcher assertions unexecuted.

Preparation now uses `npm cache add` to fetch missing canonical archives
concurrently into the existing npm cache and reuse them on subsequent packs.
Every archive still undergoes the same pinned SHA-512 check before extraction;
no dependency install or lifecycle script is run by this prefetch. The launcher
setup budget is 120 seconds; runtime and security assertions are unchanged.
A Node `24.9.0` launcher run starting with an empty canonical-archive cache
passed all 53 cases in 37.76 seconds. Reusing that cache also stages successfully
with npm offline mode. This is cold archive preparation, not a new cold consumer
installation claim. The corrected local Node `24.22.1` complete gate passed
249 cases with the same optional clipboard skip (69.65 seconds).

CodeRabbit initially skipped review because 1,283 files exceeded its 300-file
limit. The review filter excludes only nested upstream-original snapshot files;
root provenance, index and license files remain reviewable, along with runtime,
packaging, security, tests and maintained documentation. Snapshot integrity
remains checked in CI. Corrected remote CI and review results are tracked on
[PR #26](https://github.com/cogine-ai/dsh-claude-tui/pull/26).
