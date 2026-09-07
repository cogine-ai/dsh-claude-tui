# DSH 官方文档 / Official DeepSeek Harness documentation

这里维护与本项目 `package.json` 中 `@deepseek-ai/dsh` 精确版本一致的官方文档快照。官方在线文档站是 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)，其内容可能领先于本项目支持的版本。

This mirror follows the exact Harness version pinned by this project. The upstream website may describe a newer version. The snapshot preserves upstream bytes, Chinese and English editions, translation metadata, local guide images, and license notices; project-specific guidance belongs outside `snapshot/`.

## 阅读入口 / Start reading

| 主题 / Topic | 中文 | English |
| --- | --- | --- |
| 安装与概览 / Installation | [README](snapshot/README.zh.md) | [README](snapshot/README.md) |
| 用户与插件指南 / User and plugin guides | [指南](snapshot/docs/user/index.zh.md) | [Guides](snapshot/docs/user/index.md) |
| CLI 与 Profile | [CLI](snapshot/apps/cli/README.zh.md) | [CLI](snapshot/apps/cli/README.md) |
| CLI 命令参考 / CLI reference | [命令参考](snapshot/apps/cli/reference/README.zh.md) | [Reference](snapshot/apps/cli/reference/README.md) |
| 架构 / Architecture | [架构](snapshot/docs/architecture.zh.md) | [Architecture](snapshot/docs/architecture.md) |
| 子系统 / Subsystems | [子系统](snapshot/docs/subsystems/README.zh.md) | [Subsystems](snapshot/docs/subsystems/README.md) |
| 插件开发 / Plugin development | [开发指南](snapshot/docs/user/develop/basic/index.zh.md) | [Development](snapshot/docs/user/develop/basic/index.md) |
| 工具目录 / Tool catalog | [工具目录](snapshot/docs/tool-catalog.zh.md) | [Tool catalog](snapshot/docs/tool-catalog.md) |
| 配置目录 / Configuration | [配置目录](snapshot/docs/config-catalog.zh.md) | [Configuration](snapshot/docs/config-catalog.md) |
| Python SDK | [SDK](snapshot/python/sdk/README.zh.md) | [SDK](snapshot/python/sdk/README.md) |

完整文件列表及每篇文档的固定提交上游链接见 [INDEX.md](snapshot/INDEX.md)。发布标签、提交 SHA、每个文件的 Git blob、SHA-256 和字节数见 [MANIFEST.json](snapshot/MANIFEST.json)。

The [full index](snapshot/INDEX.md) pairs each document with its pinned upstream page. The [manifest](snapshot/MANIFEST.json) records the release, commit, Git blobs, SHA-256 checksums, and file sizes.

## 同步与验证 / Maintenance

在项目根目录执行 / Run from the project root:

```bash
corepack pnpm docs:dsh:sync
corepack pnpm docs:dsh:check
```

同步命令从官方仓库下载与运行时版本对应的发布标签，不跟随浮动的 `master`。也可从已有 clone 的发布标签读取，未提交的工作区内容不会进入镜像：

The sync command fetches the release tag matching the runtime pin. An existing clone can supply committed release blobs without downloading the repository again:

```bash
corepack pnpm docs:dsh:sync --source /path/to/deepseek-harness
corepack pnpm docs:dsh:check --source /path/to/deepseek-harness
```

常规 `docs:dsh:check` 完全离线，校验版本、完整文件列表、原文校验和与索引，并纳入 CI 的 `pnpm check`。带 `--source` 的校验还会对照发布标签的完整文档集合。新快照通过校验后才替换旧镜像。后续升级先更新运行时版本，再同步文档，在同一个改动中审查两者。

The regular check is offline and runs in CI through `pnpm check`. With `--source`, it additionally checks completeness against the release tree. A replacement snapshot is verified before the existing mirror is swapped out. Update the runtime pin and this snapshot together. Sync refuses to overwrite modified, missing, or extra snapshot files; preserve local work outside the generated snapshot first.

## 范围与版权 / Scope and attribution

镜像包含官方 `docs/`、根目录指南、各包、CLI、Python、native 与 vendored 组件的 README 和许可证。源码、Agent Notes、Agent 指令文件、远程媒体与文档站构建产物不在离线范围内。保留的原文可能链接到这些内容；需要时使用索引中对应的固定版本上游页面。这里的 Web 功能说明不代表本 TUI 已实现同样的界面。

Source code, Agent Notes, agent instruction files, remote media, and built website assets are outside the offline snapshot. Original links to those resources may require the pinned upstream page. Upstream Web documentation does not imply equivalent TUI features. This repository mirror is excluded from the published npm package.

官方文档版权归 DeepSeek，按随附的 [MIT License](snapshot/LICENSE) 使用。第三方组件保留其自身许可证及 [第三方声明](snapshot/THIRD_PARTY_NOTICES.md)。

Copyright belongs to DeepSeek under the included [MIT License](snapshot/LICENSE). Third-party component licenses and [notices](snapshot/THIRD_PARTY_NOTICES.md) are preserved.
