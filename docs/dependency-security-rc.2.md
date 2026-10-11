# DSH rc.2 dependency security / 依赖安全修复

This change keeps DSH `0.2.0-rc.2` and the Node engine contract. It repairs the four dependency nodes behind the released TUI `0.1.7` production audit: **14 affected package entries (6 high, 8 moderate), from five advisories**. The propagated package count is not a count of independent vulnerabilities or confirmed exploits.

本次保持 DSH `0.2.0-rc.2` 与 Node 版本契约，修复已发布 TUI `0.1.7` 审计中的四个底层依赖节点。14 个受影响包条目包含依赖传播，实际涉及五份公告；该数量不代表 14 个独立漏洞或已确认可利用路径。

| Dependency / 依赖 | Released / 原版本 | Fixed / 修复版本 | Advisory / 公告 |
| --- | --- | --- | --- |
| Sharp | `0.35.3` | `0.35.5` | [libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) |
| MCP client / core | `2.0.0` | `2.2.0` | [OAuth credentials](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) |
| fast-uri | `3.1.7` | `3.1.8` | [Host normalization](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj) |
| fflate used by libreoffice-kit | `0.8.2` | `0.8.3` | [ZIP64 parsing](https://github.com/advisories/GHSA-px8p-9vwx-vf98) |

The workspace pnpm lock originally resolved some optional and development consumers differently from the production npm shrinkwrap. After the four repairs above, a full workspace audit still reported 15 advisories: two older runtime leaves (js-yaml, compression), ten in the optional pi-ai → Google GenAI → MCP SDK v1 branch, and three in development tools. The production shrinkwrap already used patched js-yaml/compression and omitted those optional/dev nodes. They are also repaired here using pnpm convergence overrides: only declared ranges that admit the patched version are changed.

工作区 pnpm 锁与生产 npm shrinkwrap 原有部分解析差异。上述四个节点修复后，完整工作区仍有 15 份公告：两个旧运行时叶节点、可选 pi-ai/Google GenAI/MCP SDK v1 分支的十份公告，以及开发工具的三份公告。本次也在消费者允许范围内收敛到修复版，未关闭 pnpm 的依赖来源或安装脚本防护。

| Workspace dependency / 工作区依赖 | Previous / 原版本 | Patched / 修复版本 |
| --- | --- | --- |
| js-yaml | `4.3.1` | `4.3.2` |
| compression | `1.8.1` | `1.8.2` |
| MCP SDK v1 | `1.30.0` | `1.31.0` |
| hono | `4.13.2` | `4.13.7` |
| ip-address | `10.5.0` | `10.7.1` |
| proxy-addr | `2.0.7` | `2.0.8` |
| source-map-js | `1.2.1` | `1.2.2` |
| Vitest / mocker | `4.1.10` | `4.1.11` |

These are the patched floors for the observed advisories, rather than a blanket update to the newest releases. The full build/regression gate covers the updated toolchain; optional provider/server behavior beyond the exercised local paths is not certified by an audit result.

MCP SDK v1 is also declared as a development dependency to retain the workspace's existing optional Google GenAI MCP bridge. Changing only its optional peer range would remove that branch during lock regeneration. The workspace check exercises the actual GenAI `mcpToTool` adapter with the patched SDK against a local server; the published production graph continues to omit SDK v1.

工作区显式保留修复版 MCP SDK v1 开发依赖，避免仅修改 optional peer 后锁文件重建时移除原有 Google GenAI MCP 能力。新增本地服务回归通过实际 `mcpToTool` 适配器验证该路径；发布生产依赖图仍不包含 SDK v1。

## Exact upstream pins / 上游精确依赖

Sharp and fast-uri fit their DSH consumers' ranges. Two owners pin the vulnerable versions exactly: `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` pins MCP client `2.0.0`, and `@deepseek-ai/libreoffice-kit@0.1.5` pins fflate `0.8.2`. The original root fflate `0.8.3` did not protect the nested Office dependency.

[npm applies overrides only at the consuming project's root](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides). A published dependency's overrides therefore cannot enforce these changes. A small packed-consumer experiment confirmed that a publisher-side override and shrinkwrap silently restored fflate `0.8.2` in a fresh consumer, even though `npm ls` passed. Relative tarball dependencies also failed after moving the published artifact away from its source checkout.

The two owning packages are reproducibly repacked with **only their `package.json` dependency pins changed**. Their package names, versions, source files, modes, and license contents remain unchanged. The original npm URL and integrity, changed dependency, and repacked integrity are recorded in [`vendor/security/provenance.json`](../vendor/security/provenance.json). [`scripts/repack-security-dependencies.py`](../scripts/repack-security-dependencies.py) verifies original integrity and all non-manifest file bytes, and `--check` regenerates and compares both archives. These are compatibility repacks maintained by this project, rather than new upstream releases.

The root dependencies point to HTTPS tarballs in this repository at a full commit SHA. The workspace pnpm overrides select the identical checked-in tarballs through `file:` paths, preserving pnpm 11's default `blockExoticSubdeps` protection. Both locks record the repacked integrity. Ordinary npm consumers need no overrides or installation-time patches. The archives are dependency downloads, excluded from the TUI's publishable file list. Keep the archive commit reachable when merging this change; a merge commit preserves its ancestry. Installation needs access to GitHub raw content in addition to the npm registry.

两个精确固定版本的上游包采用可复现重打包，仅修改依赖声明；源码、包名与版本、文件模式及许可证均保留。原始与修改后完整性记录在 provenance 文件，维护脚本逐文件验证并可用 `--check` 复验。发布根依赖使用完整提交 SHA 的 HTTPS URL；工作区 pnpm override 选择字节相同的本地归档，保留 pnpm 11 默认的 `blockExoticSubdeps` 防护，两份锁均保存归档完整性。普通 npm 消费者无需配置 override 或运行安装补丁。合并时保留归档提交的可达性；merge commit 可保留该提交祖先。首次安装还需访问 GitHub raw 内容。

```sh
# Maintainer verification; Python 3 is only needed to reproduce the repacks.
python3 scripts/repack-security-dependencies.py --check
CI=true corepack pnpm check
corepack pnpm test:bundle:default
```

## Compatibility checks / 兼容性验证

The workspace and fresh packed-consumer gates resolve each dependency through its actual DSH owner, rather than checking only a root version:

- Attachment-local loads Sharp `0.35.5`, with actual native `heif >=1.23.2` and `rsvg >=2.63.2`; PNG resize and SVG rasterization preserve the expected pixels.
- Office's libreoffice-kit loads fflate `0.8.3`; a normal Office ZIP round trip succeeds and a missing ZIP64 extra field is rejected within a bounded worker. The old `0.8.2` control timed out and was terminated. This exercises the ZIP parser; it does not qualify native LibreOffice conversion on every platform.
- App-boot's AJV uses its actual fast-uri `3.1.8`; the advisory's percent-encoded host example and normal schema references work.
- The actual DSH MCP bridge loads client/core `2.2.0` and calls local stdio and Streamable HTTP servers. Checks cover paginated tools (including cursor progress and stalling), public/wire name mapping, success/error/structured results, static authorization, protocol/session header precedence, cancellation, and process/transport cleanup.
- Existing installed CLI, Node PTC tool turn, resume, V0/V3-to-V4 migration with predecessor byte preservation, external-runtime selection, and terminal regressions remain required.

DSH rc.2's default HTTP bridge uses static headers and does not supply an OAuth provider. Upgrading the SDK removes the affected installed version; these local tests do not certify custom OAuth plugins or their issuer-bound token handling. The default managed profile does not activate the Office skill, but the vulnerable dependency was still installed. Other profiles can reach Office ZIP parsing; its existing worker timeout bounded the old hang rather than making the parser safe.

工作区和全新 npm 安装包均通过实际 DSH 消费路径检查，覆盖原生图片库版本及转换、Office ZIP 正常/异常解析、AJV URI 规范化和真实 MCP 插件的 stdio/HTTP 行为。继续执行已有启动、PTC、恢复、迁移与终端回归。默认 MCP 静态鉴权的本地测试不代表自定义 OAuth 插件已验收；ZIP 解析测试也不代表所有平台的原生 Office 转换已验收。

## Results / 结果

Validated on 2026-10-11:

- `python3 scripts/repack-security-dependencies.py --check`: both archives, provenance, and preserved inventories regenerate byte-for-byte. The anonymous HTTPS downloads also match the committed archives.
- Frozen pnpm installation and full `pnpm audit --json`: **0 advisories**, including the optional SDK v1 branch (807 workspace dependency entries).
- Node `24.16.0` `CI=true corepack pnpm check`: **16 files / 184 passed / 1 skipped**; typecheck, build, and all 1,803 official DSH documentation files pass. This includes the fresh legacy-peer npm installed-artifact gate and actual dependency-owner checks.
- Node `22.23.3`, npm `10.9.9`, fresh ordinary npm installation with a new cache and no consumer override: **production audit 0**; all 278 installed DSH packages remain `0.2.0-rc.2`. Actual loaded Sharp native libraries are heif `1.23.5`, rsvg `2.63.2`, and vips `8.18.7`.
- Node `22.23.3` ordinary npm bundle gate: **14 passed / 1 skipped**. Actual stdio/HTTP MCP, image/ZIP/URI, CLI, PTC turn, resume, predecessor-preserving migration, and external-runtime checks pass. The skip is the opt-in real macOS clipboard qualification.
- `npm ls --all` exits successfully. npm 10 retains two existing optional extraneous leaves, `@emnapi/runtime@1.11.3` and `@img/sharp-wasm32@0.35.5`; the bundle test allows only those exact entries and rejects other tree problems.

CI checks the same complete gate and repack reproduction on Ubuntu with Node `22.19.0`, `22.22.3`, `24.2.0`, and `24.14.0`; run conclusions are available on the pull request. Audit results describe the advisory data available on the validation date, rather than a guarantee against future advisories. This branch does not publish a new npm version. External DSH installations have an independent dependency graph; this repair targets the bundled graph.

2026-10-11 验证结果：归档及来源记录逐字节复现；冻结安装后的完整 pnpm 工作区审计为 0，包含保留的可选 SDK v1 路径。Node 24 全量检查 16 个文件、184 项通过、1 项跳过，类型、构建及 1,803 个官方文档文件均通过。Node 22 使用全新缓存普通 npm 安装，无消费方 override，生产审计为 0，278 个 DSH 包全部保持 rc.2；完整安装包回归 14 项通过、1 项真实 macOS 剪贴板测试按条件跳过。`npm ls` 成功，保留两个既有可选 extraneous 条目，其他树问题均拒绝。四版本 Ubuntu CI 的实际结论记录在 PR。本分支只提交 PR，不发布新的 npm 版本；外部 DSH 的独立依赖图不在本次修复范围内。
