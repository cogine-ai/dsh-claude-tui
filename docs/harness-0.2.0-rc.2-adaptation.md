# DeepSeek Harness 0.2.0-rc.2 adaptation / 适配记录

Status: unreleased TUI `0.1.7` source candidate, targeting `dsh-v0.2.0-rc.2` at upstream commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Node engines are `^22.19.0 || >=24.2.0`. Local macOS full and ordinary-install checks passed after the engine-gate change, as recorded below. Ubuntu CI results are tracked by the [branch's PR checks](https://github.com/cogine-ai/dsh-claude-tui/actions?query=branch%3Acliq%2Fdsh-0.2.0-rc.2). Published npm TUI `0.1.6` continues to use DSH `0.1.2-rc.1`.

状态：尚未发布的 TUI `0.1.7` 源码候选版本，目标为 DSH `0.2.0-rc.2`，Node 范围为 `^22.19.0 || >=24.2.0`。Node 门禁变更后的本地 macOS 完整检查与普通安装检查均已通过，结果见下表；Ubuntu CI 结果由本分支 PR checks 跟踪。npm 已发布版本仍为 TUI `0.1.6`，其 DSH 版本不变。下文把发布标签中已确认的契约与候选版本实测结果分开记录；此前 [0.1.5 适配记录](harness-0.1.5-rc.2-adaptation.md)保留原有结论。

## Runtime selection / 运行时选择

The bundled runtime is pinned to `0.2.0-rc.2`. External runtimes must satisfy `>=0.2.0-rc.2 <0.2.1` and pass the isolated behavioral probe. A manifest match alone does not qualify a runtime. DSH `0.2.1-alpha` is outside this target, and the candidate does not adopt its removals of `both`, runtime invariant plugins, or the in-process subagent driver.

运行时依赖与官方文档以同一发布标签为目标，外部 DSH 必须同时通过版本检查和隔离行为探针。本次适配范围是 `0.2.0-rc.2`，不把后续 alpha 的破坏性变更提前应用到本版本。

Node **22.19+ in 22.x, or 24.2+** is required (`^22.19.0 || >=24.2.0`). The launcher rejects Node `24.0`/`24.1` before external-runtime discovery or user DSH Home writes. Bounded exit handling and macOS one-second polling remain in place. Fresh checks against the new dependency graph and engine gate are recorded below.

## Node subprocess compatibility / Node 子进程兼容性

Ubuntu installed-PTC checks found that the earlier Node `24.0.0` startup qualification was incomplete. In the exact release, the subprocess-local runner uses an [`import.meta.main` entry guard](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/subprocess/subprocess-local/src/bin.ts#L18), and its [built runner invocation](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/subprocess/subprocess-local/src/runner-launch.ts#L29) executes that entry directly. Node `24.0`/`24.1` lack the guard, so the helper exits without consuming the launch request. The Linux scope reports [the unconsumed bootstrap request](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/subprocess/subprocess-local/src/linux-scope.ts#L171); the Windows Job path uses the same runner. macOS directly launches these subprocesses, so its successful CLI/probe tests and local PTC checks did not reveal this platform-specific failure.

Node introduced `import.meta.main` in [24.2.0 and 22.18.0](https://nodejs.org/api/esm.html#importmetamain). The candidate preserves the existing 22.19 floor and raises the 24.x floor to 24.2. The tagged provider exposes no public runner configuration that resolves this entry-point problem. The fix keeps the exact DSH dependencies, aligns the package engines, launcher guard, and CI matrix, and adds rejection tests for Node `24.0` and `24.1` before user Home writes. Complete Ubuntu checks, including installed PTC, must pass before the new minimum is runtime-qualified.

Ubuntu 的安装包 PTC 测试推翻了此前对 Node `24.0` 完整运行资格的判断：CLI 显式调用 `runCli()` 只解决顶层入口，无法启动依赖 `import.meta.main` 的私有子进程 runner。macOS 直接创建该类子进程，因此此前 32 项启动路径测试和本地 PTC 成功只能作为局部诊断历史。候选版本现要求 Node `^22.19.0 || >=24.2.0`，在探测外部运行时及写用户 Home 前拒绝不支持的版本；未替换 DSH 精确标签或修改安全依赖。Node `24.2.0` 的最低版本资格须由完整 Ubuntu CI 证明。

## Confirmed upstream contracts / 已确认的上游契约

The following findings come from the exact published tag, rather than the upstream development branch or local test results.

| Surface | Contract in `0.2.0-rc.2` |
| --- | --- |
| Session writer | V4; older admitted generations convert through adjacent migrations while predecessors remain unchanged. |
| Tool results | `tool/result.data.message` is a tool-role message with `toolCallId`, tool source, raw content, and an optional error flag; tool-result wrappers are absent from the content-block union. |
| Assistant replies | Live Agent assistant-stream events and settled `assistant/message` events with embedded compact streams remain available. |
| PTC | Shared base row `ptc-runtime` uses `@deepseek-ai/dsh-ptc-runtime-node`; its required services are `fs`, `subprocess`, `sandbox`, and `sandboxPolicy`. |
| Tool modes | `native`, `ptc`, and `both` remain valid. The legacy TUI `code` input still normalizes to `ptc`. |
| Agent creation | `agent/created` is serial and awaited, includes `source` and optional `signal`, and replaces `agent/session-start`. Creation setup still receives the explicit Agent. |
| Commands and approval | Command registration/execution remain compatible, with optional `definitionId`; approval requests gain optional `displayReason`. |
| Settings | Resolved form values are read through `describe({ redactSecrets: true })`; updates use `settings/document-updated`. The former `get()` and `settings/updated` interfaces are absent. |
| DeepSeek API transport | API-key routes use Messages requests and event streams with `x-api-key` authentication; the installed-artifact mock follows this protocol and retains strict credential checks. |
| Subagents | `subagent/start` / `subagent/end`, foreground/background delegation, and the in-process driver remain available. Result content arrays are readonly. |
| Prompt and Loader | `personaPrefix` and the `cwd` prompt variable remain valid. `EntryTree.await()` waits for pending tasks and does not certify every settled fiber succeeded. |

官方来源：[发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)、[Session 类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/core/session/src/types.ts)、[消息类型与工具结果构造](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/llm/llm/src/message.ts)、[共享 base 组合](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/bundle/base/cordis.patch.yml)、[Agent 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/core/agent/src/runtime-types.ts)及 [Loader 等待实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/vendor/loader/src/config/tree.ts)。

Settings and transport references: [resolved settings forms](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/settings/settings/src/index.ts), [Messages transport](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/llm/llm-deepseek/README.md), and [API-key authentication](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/llm/llm-deepseek-api-key/README.md).

## Candidate changes / 候选版本变更

The candidate updates DSH dependencies and peer ranges, removes the obsolete worker-thread code-runtime insert, and uses the base bundle's sandboxed Node PTC provider. Session replay consumes V4 tool-role results. The runtime probe expects a V4 header while continuing to exercise Agent creation, image storage/readback, command execution, user/assistant events, flush, and disposal without a model request.

Provider configuration now reads `settings.describe({ redactSecrets: true })`, selects the provider's form by namespace, and uses its resolved value. The open Provider view listens to `settings/document-updated` so changes refresh without reopening the view. This replaces the removed `settings.get()` and `settings/updated` path while retaining credential-reference resolution and masked display.

The installed-artifact model mock now accepts Messages requests and event streams rather than the former chat-completions exchange. It checks `x-api-key` and `anthropic-version`, handles the Files API when images are uploaded, and verifies that the PTC result returns in the subsequent Messages request. These are local protocol checks, not production DeepSeek account or credential qualification.

本次变更包括依赖与兼容范围、共享 Node PTC 组合、V4 工具结果回放、隔离运行时探针、已解析的 Provider 设置表单及文档更新刷新。安装产物 mock 改用 Messages 流式协议，并严格检查 `x-api-key`、版本头与工具结果回传。既有 Claude Code `2.1.227` 参考布局、审批、问题、计划模式和子代理比较在本轮重新执行；上游 Web 与 Desktop 新功能不会自动成为 TUI 界面。

Six upstream service peers are explicitly included in the production dependencies so installation with `--legacy-peer-deps` still produces a complete dependency tree. The production shrinkwrap contains 278 DSH package entries, all pinned to `0.2.0-rc.2`; installed-artifact tests validate the full npm tree for missing, invalid, or conflicting packages.

The TUI creates or resumes its Agent after its containing Loader tree settles and waits for `whenIdle()` after creation returns. It does not subscribe to the removed `agent/session-start` event or wait for idle inside the serial `agent/created` callback. Its command and approval adapters retain their current invocation paths.

## Session migration and isolation / 会话迁移与隔离

Use a separate `DSH_HOME` for cross-version testing. The installed-artifact migration gate resumed both the historical `0.1.2-rc.1` V0 fixture and the `0.1.5-rc.2` V3 fixture, displayed their restored replies, read their V4 successors, and compared each predecessor byte for byte. The V3 case also verifies conversion of its user-role tool-result wrapper into a V4 tool-role result with the original call id and content.

跨版本验证使用独立 Home。受支持的旧会话经相邻格式转换后写入新的 V4 generation，旧文件应保留原字节。保留旧文件不代表新版会话可降级到旧运行时。可选 SQLite Session 后端仍需先用原运行时导出；SQLite 查询和索引不是该后端。共享 Home 的运行时按顺序启动，避免不同依赖图同时协调同一 Home 的模块与会话状态。

See the tagged [V3-to-V4 migration reference](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/session/session-format-v3-to-v4/README.md) and [launcher environment rules](launcher-environment-compatibility.md).

## Dependency qualification limit / 依赖资格限制

On 2026-10-11, `npm audit --omit=dev --json` against a temporary copy of the final production shrinkwrap and matching manifest, with `devDependencies` removed and no installation, reported **14 affected package entries: 8 moderate and 6 high**. Five advisories affect four dependency nodes: direct `sharp@0.35.3` ([libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [librsvg](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)), transitive `@modelcontextprotocol/client@2.0.0` ([OAuth credentials](https://github.com/advisories/GHSA-6qxp-vccf-f47h)), `fast-uri@3.1.7` ([host normalization](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)), and `@deepseek-ai/libreoffice-kit`'s nested `fflate@0.8.2` ([ZIP64 parsing](https://github.com/advisories/GHSA-px8p-9vwx-vf98)). The count includes dependent DSH packages; it does not mean fourteen independent advisories or confirmed reachable exploits. Root `fflate@0.8.3` is outside the affected range.

`sharp@0.35.5` and `fast-uri@3.1.8` fit the upstream consumers' ranges, although sharp requires changing the TUI's own exact pin and both require new lockfile validation. MCP client `2.2.0` conflicts with DSH `0.2.0-rc.2`'s exact `2.0.0` dependency; replacing nested fflate with `0.8.3` conflicts with libreoffice-kit `0.1.5`'s exact `0.8.2` pin, also present in its current npm release. Those two fixes require an explicit dependency override or an updated owning package, departing from this release's pinned third-party composition. No fixes were applied in this audit, and functional checks do not establish a clean dependency security audit.

生产依赖审计确认仍有 14 个受影响包条目，其中 8 个 moderate、6 个 high；底层是四个依赖节点上的五份公告，包含 DSH 依赖传播后的计数。最终 MCP client 为 `2.0.0`。此次审计未额外修改依赖；修复 MCP 与内嵌 fflate 需要明确处理上游精确固定的第三方版本，sharp 和 fast-uri 则可在消费者允许范围内更新并重新验证。可利用性与实际调用路径尚未评估。

## Validation / 验证

Local results on macOS arm64, 2026-10-11, follow. Initial results predate the tightened engine gate; follow-up results are recorded separately. They are from this adaptation's dependency graph, not transferred from the `0.1.5-rc.2` record. The existing 24 Claude PTY captures and 22 visual/semantic anchors were reused; this run adds no independently captured Claude version baseline.

| Gate | Result |
| --- | --- |
| Exact-tag API and composition inspection | Confirmed against `dsh-v0.2.0-rc.2`; inspection is not runtime qualification. |
| Official documentation sync and integrity | Passed: 1,803 original files match `dsh-v0.2.0-rc.2` / `639ed015397290b3745d163aafe02ffee4aa3f84`. |
| Initial Node 24.16.0 `CI=true corepack pnpm check` | Passed before the engine-gate change: documentation integrity, typecheck, production build, 14 test files; 177 passed and 1 optional system-clipboard test skipped. |
| Historical Node 24.0.0 launcher/probe/packed-launcher diagnostic | 3 files and 32 tests passed on macOS with explicit CLI dispatch. Subsequent Ubuntu PTC failure invalidated full runtime qualification; Node 24.0/24.1 are excluded. |
| Initial Node 22.23.3 ordinary-peer-resolution installed bundle gate | Passed before the engine-gate change: 1 file, 12 passed and 1 optional system-clipboard test skipped; fresh npm cache, ordinary peer resolution, and lifecycle scripts enabled. |
| Focused packed-launcher check after engine-gate change | Passed: 23 tests, including unsupported-version rejection before user Home writes. |
| Actual Node 24.0.0 rejection | Passed: `node lib/cli.js --dump-config` exited 1 with the unsupported-version message and the 22.19+/24.2+ requirement; the new temporary `DSH_HOME` was not created. |
| Node 24.16.0 complete check after engine-gate change | Passed: `CI=true corepack pnpm check`, exit 0, 14 files; 179 passed and 1 optional system-clipboard test skipped (180 total), 222.68 seconds. |
| Node 22.23.3 ordinary-peer-resolution installed bundle gate after engine-gate change | Passed: exit 0, 1 file; 12 passed and 1 optional system-clipboard test skipped (13 total), 226.40 seconds; fresh npm cache, ordinary peer resolution, and lifecycle scripts enabled. |
| Dependency consistency | Peer check reported no issues; all 278 production DSH package entries are `0.2.0-rc.2`, and the installed npm tree check passed. |
| Packed npm installation and runtime probes | Passed within the complete check: fresh-cache legacy-peer installation, both commands, bundled runtime, and a physically separate compatible runtime. |
| Installed Node PTC tool turn, shutdown, and resume | Passed with a local Messages/Files API mock, strict test-key validation, and isolated OS/DSH Homes. |
| V0/V3-to-V4 migration | Passed through the installed artifact: restored replies and V4 tool result verified; original predecessor bytes preserved. |
| Provider refresh and terminal regressions | Passed within the complete check: document-update refresh, layouts, live streams, command attachments, approvals, questions, plan keys, and subagents. |
| Ubuntu CI | Results tracked by [branch PR checks](https://github.com/cogine-ai/dsh-claude-tui/actions?query=branch%3Acliq%2Fdsh-0.2.0-rc.2); configured Node versions are 22.19.0, 22.22.3, 24.2.0, and 24.14.0. The new 24.2 minimum is qualified only after the complete checks pass. |

The initial Node 22 gate passed after one unchanged retry of an `ECONNRESET` installation failure, which occurred before its test assertions ran. Native koffi, node-pty, and DSH subprocess install hooks exited successfully; the complete installed dependency tree, PTC/resume, both historical migrations, external runtime, and Shift+Tab checks passed. No transport override was introduced. The fresh-cache follow-up after the engine-gate change also passed with ordinary npm resolution and scripts enabled, as recorded separately above.

Node 门禁变更后，macOS arm64 上 Node `24.16.0` 完整检查为 179 通过、1 跳过；Node `22.23.3` 普通 peer 求解、全新缓存且启用安装脚本的复验为 12 通过、1 跳过。初轮 Node 22 安装阶段网络中断后按原设置重试成功，未更改传输配置。Node 24.0 的 32 项局部启动测试属于诊断历史，不构成完整运行支持。Ubuntu 的四个 Node 版本以 PR checks 结果为准，本地 macOS 检查不能替代该证据。真实系统剪贴板检查已跳过；本次适配未发布 npm，也未建立生产模型或 Windows ConPTY 的新验收结论。上方依赖安全审计的 14 个条目仍未修复。
