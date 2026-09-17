# DeepSeek Harness 0.1.5-rc.2 adaptation / 适配记录

Status: unreleased TUI `0.1.7` source candidate. The bundled runtime and official documentation target `dsh-v0.1.5-rc.2`, upstream commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`. Published TUI `0.1.6` continues to use DSH `0.1.2-rc.1`.

状态：尚未发布的 TUI `0.1.7` 源码候选版本。运行时与官方文档固定到同一个上游发布提交；当前 npm TUI `0.1.6` 的支持版本不变。

## Runtime contracts / 运行时契约

- The bundled graph is pinned to `0.1.5-rc.2`. External runtimes must satisfy `>=0.1.5-rc.2 <0.1.6` and pass the isolated behavioral probe; `0.1.2`, earlier `0.1.5` candidates, and `0.1.6-alpha` are rejected.
- Node `22.19+` and `24+` remain supported. DSH's CLI now guards startup with `import.meta.main`, which Node added in `22.18` and `24.2`. On Node `24.0`/`24.1`, both the launcher and probe explicitly invoke the imported CLI's exported `runCli()`; arguments, process replacement, and exit behavior are preserved. Newer Node versions keep direct invocation. See the [Node API history](https://nodejs.org/download/release/v24.4.0/docs/api/esm.html#importmetamain).
- Agent setup receives the explicit Agent argument instead of reading removed `ctx.agent`. Persisted model selection still wins when resuming without a CLI override.
- The profile uses `personaPrefix`. PTC remains the `0.1.5` worker-thread implementation; the `0.1.6-alpha` PTC renames are intentionally outside this target.
- Slash-command image attachments carry `type: 'image'`, preserving image-only and mixed submissions under the expanded command attachment contract.
- Live replies use `agent/assistant-stream` start/chunk/end frames, filtered by Agent and attempt identity. V3 `assistant/message` settlements replace drafts once. Failed or abandoned attempts remove transient drafts; committed interrupted prefixes remain visible.
- Cold replay reads V3 Session events. TTFT and throughput use the official compact-stream first-token reader, preserving tool-only timing without depending on removed top-level chunk events.
- On macOS, the launcher and isolated probe default Chokidar watchers to one-second polling. This covers skills, settings, and profile patches while retaining automatic updates. Other platforms retain upstream native watching. The normal launcher preserves explicit `CHOKIDAR_USEPOLLING` / `CHOKIDAR_INTERVAL` values; the probe uses isolated defaults. The bundle also configures skill polling when mounted directly.
- The runtime probe creates a real Agent, persists and reads an image, executes a command, verifies a V3 Session header and user/assistant events, flushes, and disposes the Agent without a model request.

对应变更包括：显式 Agent setup、`personaPrefix`、带类型的命令图片附件、新版实时回复流与 V3 回放。重试不拼接失败草稿，中断后保留已提交部分；首 Token 和吞吐率从持久化聚合流恢复。

远端 CI 发现 Node `24.0` 缺少 `import.meta.main`，导致上游入口直接退出。已在启动器和隔离探针中补充显式 CLI 调用，继续支持 Node `22.19+` 与 `24+`，无需修改上游包或提高最低版本。

## Terminal continuity / 终端体验

The existing Claude Code `2.1.227` PTY fixtures remain unchanged. The welcome panel, orange logo, prompt geometry, semantic colors, cursor ownership, menus, approvals, questions, plan indicator, tool rows, and subagent presentation retain their existing reference comparisons. Harness identity, model, permissions, and runtime details remain truthful. This is the existing scoped reference target, not a claim of equivalence to every Claude Code feature or a newer release.

保留现有 Claude Code 参考布局与键盘体验，同时展示真实 Harness 身份和能力；上游 Web 侧栏、文件上传和预览没有自动成为 TUI 功能。

## macOS shutdown qualification / macOS 退出验证

An installed-artifact tool-turn test exposed a hang when the inherited OS Home contained a populated global skills directory. A native process sample showed the main thread blocked in `uv__fsevents_close` while the FSEvents thread waited in `FSEventStreamStart`. Targeted watcher tracing identified `SkillWatchManager.closeWatcher`. The same installed tool-turn and resume scenario passed against that global skills directory with upstream's supported `watchUsePolling: true` and `watchPollIntervalMs: 1000` options. The bundle applies those options only on macOS, retaining automatic refresh with up to polling-scale detection latency.

The first Node 24.0 full check also exposed an intermittent plan-mode exit hang. Reproduction against the installed dependency graph yielded the same `uv__fsevents_close` block; native watcher tracing identified remaining Cordis HMR and file-settings paths. The launcher/probe now apply the supported Chokidar polling environment defaults across that child runtime, without modifying upstream code or the parent shell. Explicit caller overrides remain honored by the normal launcher. With the updated launcher on that installed dependency graph, 30 repeated plan-mode launches exited successfully; tracing recorded no native watcher-close calls.

Installed-artifact tests now isolate both DSH Home and OS/XDG homes. A synthetic user skill proves that discovery is active during the tool-turn, exit, and resume test without scanning personal skills or settings.

macOS 实测发现全局 skills 原生监听器在关闭时阻塞；已用调用栈和监听器路径定位，并验证 1 秒轮询可以正常退出与恢复会话。进一步的 Node 24.0 安装产物复现与调用栈确认，配置热更新及 settings 监听同样可能阻塞，因此启动器和探针在 macOS 子进程中为这些监听统一设置轮询默认值，保留自动刷新及正常启动时的显式环境覆盖；安装包测试隔离操作系统 Home，使用合成 skill 验证发现和退出行为。

## Documentation / 文档

The sync script copied 1,412 original files from the exact release tag. `MANIFEST.json` and the bilingual index record the commit, Git blobs, SHA-256 hashes, and byte sizes. Source verification compares committed release blobs, not the local upstream checkout. The generated mirror is excluded from the npm artifact. English/Chinese READMEs distinguish this unreleased candidate from the currently published package.

官方文档同步覆盖中英文原文、目录、图片和许可证，源码及离线完整性校验使用同一个固定发布版本；历史适配记录保留原有版本和验证结论。

## Validation / 验证

Local qualification on macOS arm64, 2026-09-18:

| Gate | Result |
| --- | --- |
| Node 24.0.0 `corepack pnpm check` | Passed: official mirror, typecheck, build, 14 test files; 160 passed, 1 optional system-clipboard test skipped. |
| Node 24.0.0 focused process/probe/packed-launcher tests | Passed: 3 files, 24 tests, including literal argv, exit errors, watcher defaults, and explicit overrides. |
| Node 22.23.2 `corepack pnpm test:bundle:default` | Passed: fresh npm cache and ordinary peer resolution; 11 passed, 1 optional system-clipboard test skipped. |
| Exact-tag documentation verification | Passed: 1,412 files match `dsh-v0.1.5-rc.2` / `fb2c4b9e698e30edb738bca4cf0618587db7d203`. |
| Dependency checks | `pnpm peers check` passed; all 231 DSH package entries in production shrinkwrap are `0.1.5-rc.2`. Installed-artifact tests validate the full npm dependency tree. |

The installed-artifact suite covers bundled and physically separate compatible Harness launches, real local-mock PTC tool turns, live skill discovery, graceful exit, Session resume, plan-mode keys, managed-state preservation, and version-0-to-V3 migration from a fixture written by `0.1.2-rc.1`. The migration checks both the new V3 file and byte-for-byte preservation of its original log. The existing Claude reference corpus is unchanged; new live-stream tests cover retries, interruption, Agent isolation, draft/cursor preservation across resizes, and settlement without duplicate text.

Node 24 最终全量检查与 Node 22 普通 npm 安装包检查结果见上表。旧会话迁移保留原始文件；Claude 参考布局回归、新流式状态与 macOS 退出问题均有对应验证。

## Data and qualification limits / 数据与验证边界

Supported older Session logs migrate through upstream's adjacent generations into V3 while preserving original files. Upgraded logs cannot be read by older runtimes. Use isolated Homes for cross-version testing. The optional old SQLite Session backend still requires export with its original runtime; query/index SQLite is separate.

This adaptation does not qualify `0.1.6-alpha`, add upstream Web surfaces, publish to npm, or establish real-account model behavior. Production-provider, actual system clipboard, and Windows ConPTY qualification require separate evidence. Remote CI results are tracked on [PR #20](https://github.com/cogine-ai/dsh-claude-tui/pull/20).
