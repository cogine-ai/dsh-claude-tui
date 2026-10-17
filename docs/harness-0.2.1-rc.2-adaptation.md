# DeepSeek Harness 0.2.1-rc.2 adaptation / 适配记录

Target: TUI `0.1.9`, using `dsh-v0.2.1-rc.2` at upstream commit
`687f282e8625c6b8d11ff58211a90524be2e4317`. This record separates source
inspection and executed checks from publication. The
[v0.1.9 Release](https://github.com/cogine-ai/dsh-claude-tui/releases/tag/v0.1.9)
and npm metadata separately establish the published commit and registry identity.

适配目标为 TUI `0.1.9` 及上述精确 DSH 标签。源码确认、运行验证与发布状态分别记录；
实际发布提交和 registry 身份由 v0.1.9 Release 及 npm metadata 单独核验。
旧版通过数及 Ubuntu CI 记录保留在 [0.2.0 适配记录](harness-0.2.0-rc.2-adaptation.md)，
不转移为本版本证据。

## Runtime and documentation / 运行时与文档

The bundled runtime is pinned to `0.2.1-rc.2`. An external runtime must satisfy
`>=0.2.1-rc.2 <0.2.2` and pass the isolated behavioral probe. Older `0.2.0`
packages, `0.2.1` alphas, and `0.2.1-rc.1` are excluded. Node engines remain
`^22.19.0 || >=24.2.0`; no Node or OS qualification transfers from a prior graph.

The [official documentation mirror](upstream/dsh/README.md) contains **2,083
original files** from this exact tag and commit, including English, Chinese,
translation metadata, images, and licenses. Its manifest and index retain
source hashes and links. This mirror is excluded from the npm artifact.

包内运行时与文档镜像使用同一精确版本。外部运行时必须同时满足版本范围和隔离探针，
仅版本匹配不构成资格认证。Node 要求保持不变；2,083 份官方原文件保留上游字节、
双语内容及来源清单，不进入 npm 安装包。

## Confirmed compatibility changes / 已确认的兼容变化

| Surface | Upstream change and TUI adaptation |
| --- | --- |
| Tool presentation | Only `native` and `ptc` remain. The launcher rejects `both` and unknown values before discovery, probes, or Home writes; `code` remains a `ptc` alias. |
| Runtime invariants | `dsh-invariants` and all `./invariant` companions are removed. Their dependencies, inserts, and overrides must not remain in the TUI composition. |
| Subagents | Managed activations replace foreground and Job-backed results. The TUI displays an activation receipt as Started and renders the final parent completion notice in full. Roster labels match durable catalog child IDs rather than launch order. The standalone `dsh-subagent-in-process-driver` is removed. |
| Working directory | The built-in `{{cwd}}` prompt variable is removed. The directory service supplies persisted current-directory context; the header and file mentions follow its value. File indexing refreshes after changes and discards stale scans. `Session.header.cwd` still identifies the original project, including Session-picker project filtering. |
| Credentials | Stored references precede exported environment variables. The TUI keeps interactive authentication services and reads source/writability from `credentials.describe()`. The shipped headless profile instead disables stored authentication by default. |
| Models and settings | Existing selection, resolved-settings, and update-event calls remain valid. DSH owns advertised models, effort metadata, defaults, and provider authentication. New upstream model or Web API support does not establish a new TUI interface. |
| Session persistence | The format remains V4. Experimental `plugin:*` records are separate from ordinary Session event types. Existing transcript event handling remains applicable; retaining version 4 does not establish downgrade support. |
| JSONL plugin export | Upstream now exports a function-plugin namespace without a default class. The TUI composes it through DSH's bundle rather than constructing that former class. |
| Plugin compatibility | An explicit `engines.dsh` takes precedence over DSH peer ranges; when absent, peers remain the compatibility source. Subpath display metadata now comes from locale and icon exports rather than a subpath `package.json`. |

本轮明确拒绝已移除的 `both`，清除 invariant 与独立 driver，适配托管子代理和持久化目录。
交互 TUI 保留凭据存储，不照搬 headless 的禁用设置；已保存 Key 优先于环境变量的行为
由 DSH 决定，界面读取服务报告的来源与可写性。会话选择仍按最初项目过滤，文件补全则
跟随当前执行目录。V4 不升版不代表可以降级读取所有新记录。

Official references pinned to the target commit:

- [Tool modes](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.1/tool-presentation-mode/guide.md), [invariant removal](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md), and [subagent activations](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md).
- [Working directory](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.1/working-directory/guide.md), [stored credential precedence](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.2/stored-credentials-precedence/guide.md), and [V4 Session types](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts).
- [JSONL plugin](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.1/jsonl-persistence-plugin/guide.md), [plugin engines](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md), and [subpath display metadata](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.md).

## Dependency repairs / 依赖修复

The official `dsh-mcp-client@0.2.1-rc.2` declares
`@modelcontextprotocol/client@2.2.0`, so this adaptation replaces the previous
`0.2.0-rc.2` MCP manifest repack with that official owner package. MCP behavior
still requires fresh owner-path stdio/HTTP checks against the installed artifact.

Upstream `libreoffice-kit@0.1.5` still pins `fflate@0.8.2`. The existing
manifest-only LibreOffice repack retains its `fflate@0.8.3` repair and pinned
public archive. Sharp, URI, and other retained dependency repairs require
validation against the new locks; old audit counts are historical.

官方 MCP 包已内置此前的 client `2.2.0` 修复，可删除旧 MCP repack；LibreOffice 的
上游精确 pin 尚未修复，保留现有 `fflate@0.8.3` 归档。保留修复不等于新依赖图已经
通过审计，结果须以本轮锁文件和安装产物检查为准。

Sources: [MCP dependency owner](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/mcp/mcp-client/package.json),
[upstream lock](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/pnpm-lock.yaml),
and [local repack record](../vendor/security/README.md).

## Verification / 验证

The following table records this adaptation's local checks. The existing 24 Claude
PTY frames and 22 visual/semantic anchors are reused; this adaptation adds no
independently captured Claude baseline.

The complete check ran on macOS arm64 with Node `24.16.0` on 2026-10-18:
`CI=true corepack pnpm check` exited **0**, with **16 files, 215 passed, and
1 skipped**. The skip was the opt-in real system-clipboard test.
The later Node `22.23.3` ordinary npm peer-resolution installed-bundle gate
also exited **0**: **1 file, 16 passed, 1 skipped** (17 total), in **331.66
seconds**, with a fresh npm cache. It additionally verified packed-TUI replay of
the released `0.2.0-rc.2` V4 fixture; that added case is not counted in the earlier
Node 24 complete-run total.

| Gate | Result |
| --- | --- |
| Exact-tag API/composition inspection | Confirmed against `687f282e8625c6b8d11ff58211a90524be2e4317`; read-only inspection is not runtime acceptance. |
| Official documentation synchronization | Passed: integrity and completeness of 2,083 original files at the exact tag and commit. |
| Typecheck, production build, and complete serial tests | Passed: Node `24.16.0`, `CI=true corepack pnpm check`, exit 0; 16 files / 215 passed / 1 optional real system-clipboard test skipped. |
| Dependency tree and audits | Passed: full installed `npm ls` tree; workspace audit 0 and npm production audit 0. Production graph has 644 dependencies and 299 DSH packages, all DSH packages pinned to `0.2.1-rc.2`. |
| Removed tools mode and Home-preservation checks | Passed: rejection before runtime discovery and writes, for new and existing Homes. |
| Working-directory and terminal regressions | Passed: current-directory header/file mentions, stale-scan rejection, layouts, streams, images, command attachments, approvals, questions, and plan-mode keys. |
| Fresh packed installation and external-runtime probe | Passed with a fresh npm cache and `--legacy-peer-deps`; both command names, bundled DSH, and a physically separate system DSH were exercised. |
| Installed native subagent lifecycle | Passed: real DSH activation and `send_message` through the local Messages server, successful settlement, and complete closing-message text in the TUI and durable parent log. |
| Installed PTC model turn, shutdown, and resume | Passed against the local Messages/Files server with authentication checks and the sandboxed Node runtime. |
| Historical V0/V3-to-V4 migration and predecessor preservation | Passed through the installed artifact; restored replies/tool results and original bytes checked. |
| Released `0.2.0-rc.2` V4 fixture | Passed: real old-writer generation, new-backend read/write, and installed TUI resume on Node `22.23.3`; restored reply/tool result checked and original log bytes preserved as an unchanged prefix. This added case was not in the earlier Node 24 complete run. |
| MCP and dependency-owner security regressions | Passed: owner-path stdio/HTTP MCP and image/Office ZIP/URI checks. The retained Office repack passed byte-for-byte `--check` reproduction. |
| Independent implementation and dependency review | Completed with no blocking findings; the packed subagent gate was strengthened to require successful settlement and the closing message. |
| Node `22.23.3` ordinary-peer-resolution installed bundle | Passed: exit 0; 1 file / 16 passed / 1 optional clipboard test skipped (17 total), 331.66 seconds. Fresh-cache ordinary npm resolution, native subagents, PTC, MCP, probes, resume, and all three historical writer fixtures were exercised. |
| Final serial workspace consistency | Passed: Node 22 frozen install (4.2 seconds, 708 reused, 0 downloads), then Node 24 `tsc --noEmit` and runtime-probe/dependency-security/optional-MCP tests (3 files / 12 passed). Exact-source documentation verification matched all 2,083 files; `git diff --check` passed. |
| Ubuntu CI for this adaptation | Local results below do not establish CI completion; earlier `0.2.0-rc.2` CI is historical. |
| Production-provider requests and Windows ConPTY | Not run for this adaptation. |
| Real system clipboard | Opt-in test skipped in the complete check. |
| Publication and registry identity | Verify separately through the [v0.1.9 Release](https://github.com/cogine-ai/dsh-claude-tui/releases/tag/v0.1.9) and npm metadata; the local checks above do not establish publication. |

The first complete run exposed an overbroad new test assertion: it rejected
`run_in_background` anywhere on the wire, including Bash's legitimate field.
The assertion now checks only the subagent schema; the complete rerun passed.
That failure was in the test, not the product.

Two overlapping preparatory workspace installs caused one transient `ENOENT`.
The final serial frozen install and checks above completed successfully, with
no unresolved installation or verification failure.

2026-10-18 的 macOS arm64 / Node `24.16.0` 完整门禁退出 0：16 个文件、215 项通过、
1 项真实系统剪贴板 opt-in 检查跳过。全新安装、依赖树、真实 DSH 子代理消息与成功收尾、
本地 PTC 轮次、恢复、旧格式迁移、外部运行时、目录与界面回归均通过；工作区及生产依赖
审计均为 0。后续 Node `22.23.3` 全新缓存普通 peer 求解安装包门禁亦退出 0：1 个文件、
16 项通过、1 项可选剪贴板检查跳过，耗时 331.66 秒，包含新增旧版 V4 fixture 的真实
TUI 恢复、工具结果及原件字节前缀保留。此新增项不计入早前 Node 24 的 215 项通过。

安装产物测试使用本地 Messages/Files 和 MCP 服务，不代表生产模型、OAuth、自定义插件
或所有平台的 LibreOffice 转换已验收。独立 Home 用于跨版本测试；旧日志原件保留不构成
降级支持。此前测试曾误将 Bash 合法字段计入子代理 schema 检查，缩小断言后完整重跑通过，
该问题属于测试错误。预备阶段并行安装造成的临时 `ENOENT` 已通过串行冻结安装及其后
12 项定向复验解决，最终类型、文档来源和 diff 检查通过，无未解决的安装或验证失败。

See [launcher rules](launcher-environment-compatibility.md) and
[release notes](releases/v0.1.9.md).
