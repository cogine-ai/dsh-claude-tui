<h1 align="center">DSH Claude TUI</h1>

<p align="center"><strong>熟悉的 Claude Code 风格终端，真实的 DeepSeek Harness 能力。</strong></p>

<p align="center"><a href="./README.md">English</a> · 简体中文</p>

<p align="center">
  一条命令启动。通过高保真终端界面，直接使用 DSH 的模型、Session、工具、审批与子代理。
</p>

<p align="center">
  <a href="https://github.com/cogine-ai/dsh-claude-tui/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/cogine-ai/dsh-claude-tui?style=flat-square&logo=github" /></a>
  <a href="https://github.com/cogine-ai/dsh-claude-tui/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/cogine-ai/dsh-claude-tui/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/dsh-claude-tui"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-claude-tui?style=flat-square&logo=npm" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-4d6bfe?style=flat-square" /></a>
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
  <img alt="119 tests" src="https://img.shields.io/badge/tests-119%2F119-4eba65?style=flat-square" />
</p>

<p align="center">
  <img width="1100" alt="DSH Claude TUI 终端预览" src="./docs/assets/terminal-preview.svg" />
</p>

> [!NOTE]
> 这是独立社区项目，与 Anthropic 或 DeepSeek 没有隶属、背书或赞助关系。“Claude Code”仅用于标识固定版本的交互目标；仓库不包含 Anthropic 源代码。详见[商标与兼容性声明](./DISCLAIMER.md)。

## 一条命令开始

需要 Node.js `22.19+` 或 `24+`。

```bash
npx dsh-claude-tui
```

这条命令会安装并进入 npm `latest` 标签指向的 TUI，不要求全局安装 `dsh`、拉取仓库、安装 pnpm 或手工创建 profile。如需精确固定本次文档修正版，运行 `npx dsh-claude-tui@0.1.3`。

真实模型请求需要所选 DSH Provider 的凭据。使用 `/provider` 查看或录入凭据，使用 `/model`（或 `Option+P` / `Alt+P`）切换 DSH 提供的模型与 effort。

如果会反复使用：

```bash
npm install --global dsh-claude-tui@0.1.3
dshtui
```

全局安装会同时提供短命令 `dshtui` 和正式命令 `dsh-claude-tui`；两者运行同一个 CLI 入口。

使用 `dshtui --resume` 打开 Session 选择器，或用 `--resume <session-id>` 精确恢复。

## 你能获得什么

| 方面 | 用户可见能力 |
| --- | --- |
| 熟悉的终端 | Claude 风格欢迎面板、输入框、菜单、对话记录、状态栏、审批、问题和 Agent 状态 |
| 真实 Harness | DSH 管理的模型、持久化 Session、命令、审批策略、工具、结构化问题与子代理 |
| 实时模型配置 | Provider/model 列表、DSH 暴露的 effort 级别、默认值保存、API Key 掩码录入和凭据来源 |
| 高效输入 | 多行编辑、提交或 steer、中断、历史搜索、斜杠补全和有边界的 `@` 文件补全 |
| 清晰的执行状态 | reasoning、工具调用/结果、缓存命中率、Token、TTFT、吞吐率和 turn 结果 |
| Session 与 Agent | 新建/恢复 Session、安全 flush、前后台子代理和活动 Agent roster |
| 可验证运行环境 | 欢迎面板显示真实 TUI/Harness 版本、system/bundled 来源、DSH Home 与工具模式 |

TUI 从 DSH 读取能力，不写死模型、effort、凭据或审批行为。

## 常用操作

| 按键或命令 | 作用 |
| --- | --- |
| `Enter` | 空闲时提交，运行时 steer |
| `Shift+Enter` | 换行 |
| `Esc` / `Ctrl+C` | 中断当前 turn |
| `Ctrl+R` | 搜索历史 prompt |
| `Ctrl+O` | 展开或收起工具详情 |
| `Option+P` / `Alt+P` 或 `/model` | 打开 DSH 实时模型选择器 |
| `/provider` | 查看或更新 DSH Provider 凭据 |
| `Left Arrow` | 显示或隐藏活动 Agent roster |
| `Ctrl+D` | 空输入时连续按两次，安全退出 |

在 TUI 中运行 `/help` 可查看当前命令列表。

## 兼容已有 DSH 环境

默认启动逻辑让用户无需先选择安装策略：

1. 优先复用所选 `$DSH_HOME` 已关联的兼容 DSH，或 `PATH` 中来源可验证的 `dsh`；
2. 在不继承凭据的临时 Home 中执行兼容探针；
3. 没有外部候选通过时，自动使用包内由 shrinkwrap 固定的 DSH `0.1.0-rc.6`。

外部 DSH 当前须满足 `>=0.1.0-rc.6 <0.1.1` 并通过 Agent/Session 探针。Home 可安全共享时，已有凭据、Session、设置和无关 profile 会继续可用。启动器不会覆盖不属于自己的 profile；隐式默认 Home 不安全时可退回 `~/.dsh-claude-tui` 并显示提示，显式 `DSH_HOME` 冲突则给出可操作错误，不会偷偷移动数据。

常用环境变量：

| 变量 | 行为 |
| --- | --- |
| `DSH_CLAUDE_TUI_RUNTIME=auto` | 默认：先尝试兼容的系统 DSH，再使用包内 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=system` | 必须使用兼容的外部 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=bundled` | 始终使用包内 DSH |
| `DSH_HOME=/path` | 指定 DSH 数据 Home |
| `DSH_TOOLS_MODE=native\|code\|both` | DSH 工具呈现模式，对应 Standard、PTC、Both |

不同 Harness 版本不要并发使用同一个 `$DSH_HOME`；并发运行请使用独立 Home。Harness 仍处于预发布阶段，数据移动只能走其明确支持的迁移路径。完整选择和恢复规则见[启动器环境兼容说明](./docs/launcher-environment-compatibility.md)。

## 兼容与验证

当前交互目标是已观测的 Claude Code `2.1.227` TUI。运行能力以 Harness 为准，不模拟 Claude 私有的模型行为、云服务、账号状态或权限语义。

当前资格范围：

- macOS arm64 与 Linux x64；
- true-color、xterm-compatible 终端；
- **24** 个独立捕获的 PTY 参考帧，**22** 个自动视觉/语义锚点；
- **119/119** 个测试，覆盖 `80x24`、`100x30`、真实 tarball、两个已安装命令入口、Session 恢复、审批、问题和前后台子代理。

Windows 启动路径已经实现，但尚未纳入发布资格验证。详见[完整视觉与语义资格报告](./docs/visual-qualification-2.1.227.md)和 [v0.1.0 制品加固基线](./docs/release-hardening-v0.1.0.md)。

## 开发与参与

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

资格门包含 TypeScript 检查、全部 Vitest 终端测试和生产构建。欢迎提交聚焦的 issue 与 pull request；视觉一致性修改应附独立捕获的参考证据，或明确记录 Harness 语义边界。

近期方向包括更丰富的附件与补全、更完整的 Session 管理、更多 plan/todo/后台任务状态，以及更多终端和操作系统资格验证。

## License

项目原创代码采用 [MIT License](./LICENSE)。产品名称与商标归各自权利人所有；MIT License 不授予任何第三方商标使用权。
