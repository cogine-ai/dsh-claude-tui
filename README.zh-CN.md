<h1 align="center">DeepSeek Harness — Claude TUI</h1>

<p align="center"><strong>保留 Claude Code 的肌肉记忆，底层换成 DeepSeek Harness。</strong></p>

<p align="center"><a href="./README.md">English</a> · 简体中文</p>

<p align="center">
  一个非官方、高保真的 Claude Code 风格 DeepSeek Harness 终端界面。<br />
  基于真实 PTY 捕获逐格重建，并对字符、颜色、坐标和交互状态进行自动验证。
</p>

<p align="center">
  <a href="https://github.com/cogine-ai/dsh-claude-tui/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/cogine-ai/dsh-claude-tui?style=flat-square&logo=github" /></a>
  <a href="https://github.com/cogine-ai/dsh-claude-tui/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/cogine-ai/dsh-claude-tui/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/dsh-claude-tui"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-claude-tui?style=flat-square&logo=npm" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-4d6bfe?style=flat-square" /></a>
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
  <img alt="118 tests" src="https://img.shields.io/badge/tests-118%2F118-4eba65?style=flat-square" />
</p>

<p align="center">
  <img width="1100" alt="DeepSeek Harness Claude TUI 终端预览" src="./docs/assets/terminal-preview.svg" />
</p>

> [!NOTE]
> 这是一个独立社区项目，与 Anthropic 或 DeepSeek 没有隶属、背书或赞助关系。“Claude Code”仅用于标识固定版本的兼容目标；仓库不包含 Anthropic 源代码。详见[商标与兼容性声明](./DISCLAIMER.md)。

## 为什么做这个项目

DeepSeek Harness 提供了可组合的 Agent、Session、工具、审批、用户问题和子代理运行时；Claude Code 则建立了一套很多开发者已经形成肌肉记忆的终端工作流。

这个插件在不 fork Harness Core 的前提下，把两者连接起来：

- **操作熟悉：** Claude 风格的主界面、输入框、菜单、对话记录、审批、问题和 Agent 状态。
- **语义真实：** 使用 Harness 的真实模型、持久化 Session、命令、权限、工具与子代理。
- **高保真可证明：** 从真实 Claude Code `2.1.227` PTY 独立捕获 24 个参考帧，其中 22 个接入自动对比。
- **验证的是终端，不是效果图：** 比较 buffer、字符格坐标、RGB 样式、硬件光标和状态转换。

它是一个真正的 Harness 外部 bundle，不是网页换肤，也不是预录的终端动画。

## 立即体验

前置条件：Node.js `22.19+` 或 `24+`。命令自带已验证的 DeepSeek Harness
版本，不要求全局安装 `dsh`、拉取仓库、安装 pnpm 或手工创建 profile。

当前已发布基线为 [`dsh-claude-tui@0.1.0`](https://www.npmjs.com/package/dsh-claude-tui/v/0.1.0)。
对应的源码 Release 为 [`v0.1.0`](https://github.com/cogine-ai/dsh-claude-tui/releases/tag/v0.1.0)。
下文的环境兼容逻辑已经进入当前 `0.1.1` 源码，计划随下一个补丁版本发布；npm 上的
`0.1.0` 仍是原先只使用包内固定 DSH 的启动器。

```bash
npx dsh-claude-tui
```

如果会反复使用，也可以选择全局安装；两种方式调用的是同一个启动器：

```bash
npm install --global dsh-claude-tui@0.1.0
dsh-claude-tui
```

真正向模型发送请求时，需要配置所选 Harness 模型提供方的凭证。

默认 `auto` 模式会先尝试复用所选 `$DSH_HOME` 已关联的兼容 DSH，再检查 `PATH`
中可验证来源的 `dsh`。外部 DSH 必须位于 `>=0.1.0-rc.6 <0.1.1`，并通过一个使用
临时目录、不会继承凭据的 Agent/Session 兼容探针；没有候选通过时，自动使用包内固定
的 `0.1.0-rc.6`。如需确定性行为，可设置
`DSH_CLAUDE_TUI_RUNTIME=system|bundled`，分别表示必须使用外部 DSH，或完全跳过
外部发现。

只要所选 Home 可安全共享，已有凭据、Session、设置和无关 profile 都继续可用。
如果旧 `claude-tui` profile 不属于本启动器，它会被完整保留，启动器改用命名空间化的
`dsh-claude-tui`。如果默认 `~/.dsh` 中存在损坏的启动器标记，程序会自动改用包内
DSH 与 `~/.dsh-claude-tui`，并在 TUI 内明确提示凭据和 Session 没有被复制。非空的
显式 `DSH_HOME` 永远不会被偷偷替换；存在不安全冲突时会直接给出可操作错误。

Harness 仍处于预发布阶段，并不承诺所有磁盘状态版本之间都可迁移；数据转移只能走
Harness 明确支持的迁移路径。完整的选择算法、探针隔离、所有权状态和恢复开关见
[启动器环境兼容说明](./docs/launcher-environment-compatibility.md)。

不要让不同 Harness 版本并发使用同一个 `$DSH_HOME`：Harness 会管理共享的 profile
模块 fallback，任一进程都可能按自己的依赖树重新校正它。顺序使用已经纳入验证；如需
并发运行，请为本启动器设置独立的 `DSH_HOME`。

## 已实现

| 界面 | 当前能力 |
| --- | --- |
| 主界面 | normal-buffer 回滚、带已验证 DSH 运行时来源的新 Session 展开欢迎面板、恢复 Session 紧凑 Header、编辑器和状态栏 |
| 输入 | 多行编辑、提交/steer、中断、反向历史搜索 |
| 补全 | 斜杠命令和有边界的 `@` 工作区文件补全 |
| 模型 | 从 DSH 实时读取 provider/model 与准确 effort，支持当前 Agent 切换和保存 DSH 默认值 |
| Provider | 展示 DSH 凭据来源/可写性，掩码录入 API Key，并提供窄范围首次启动引导 |
| 对话记录 | 用户、助手、reasoning、工具调用/结果、usage、请求和 turn 结果 |
| 协议 | 接入真实 Harness 审批与结构化用户问题 provider |
| Agent | 前台/后台子代理状态、可展开结果和活动 Agent roster |
| Session | 创建、精确 ID 恢复、交互式选择、flush 与终端恢复 |

常用快捷键：

| 按键 | 作用 |
| --- | --- |
| `Enter` | 空闲时提交，运行时 steer |
| `Shift+Enter` | 换行 |
| `Esc` / `Ctrl+C` | 中断当前 turn |
| `Ctrl+R` | 搜索历史 prompt |
| `Ctrl+O` | 展开或收起工具详情 |
| `Option+P` / `Alt+P` | 打开 DSH 实时模型选择器 |
| `Left Arrow` | 显示或隐藏活动 Agent roster |
| `Ctrl+D` | 空输入时连续按两次，安全退出 |

也可以用 `/model` 打开模型选择器，用 `/provider` 查看或更新 DSH 暴露的 provider 凭据。模型名、effort、默认模型、凭据引用、来源优先级和可写性都不由 TUI 写死。具体边界见[模型与 Provider 交互设计](./docs/model-provider-interactions.md)。

## 高保真验证

以 true-color xterm-compatible PTY 中的 Claude Code `2.1.227` 为基线：

- **24** 个参考帧，**22** 个自动视觉/语义锚点；
- **118/118** 个测试，包含 `80x24`、`100x30` 的终端行为；
- 真实 Harness 运行覆盖审批、问题及前台/后台子代理；
- 新 Session 的展开面板遵循真实捕获的边框几何，并展示实际 Harness/Home/tool mode 与 `powered by dsh`；恢复 Session 的紧凑状态保留已验证的顶部安全留白。

[完整资格报告](./docs/visual-qualification-2.1.227.md)

## 兼容边界

仅覆盖已观测到的 Claude Code `2.1.227` TUI。运行数据和能力以 Harness 为准，不模拟其未提供的 Claude 私有状态；新版本需重新验证。

外部 Harness 复用目前只覆盖 DSH `0.1.0` 系列
（`>=0.1.0-rc.6 <0.1.1`），并且仍须通过运行时探针；仅版本号匹配不视为兼容。

`v0.1.0` 的资格矩阵面向 macOS arm64 与 Linux x64，并要求 true-color、
xterm-compatible 终端。Windows 启动路径已经实现，但尚未纳入发布资格验证。

## 开发与验证

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

资格门会执行 TypeScript no-emit、全部 Vitest 终端测试和生产构建。

## 路线图

**v0.1.0 — 已发布基线**

- 从干净 checkout 生成由 shrinkwrap 固定依赖的 npm 包；
- 以 `npx dsh-claude-tui` 完成安装与启动，不再要求用户手动安装 Harness 或 profile；
- 已验证首次初始化、重复启动幂等性、tarball 真实运行路径和真实 DeepSeek 请求。

完整验证门槛和结果见 [v0.1.0 Release Hardening 报告](./docs/release-hardening-v0.1.0.md)。

**下一步 — 由反馈驱动的 v0.1.x**

- 更丰富的附件与补全界面；
- 更完整的 Session 管理和重命名流程；
- 更多 plan、todo 与后台任务状态；
- 覆盖更多终端模拟器与操作系统。

欢迎提交 issue 和聚焦的 pull request。涉及视觉一致性的修改，应附带独立捕获的参考证据，或明确记录 Harness 语义边界。

## License

项目原创代码采用 [MIT License](./LICENSE)。产品名称与商标归各自权利人所有；MIT License 不授予任何第三方商标使用权。
