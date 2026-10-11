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
  <img alt="DeepSeek Harness 0.2.0-rc.2 源码适配目标" src="https://img.shields.io/badge/DSH-0.2.0--rc.2-536af5?style=flat-square" />
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
</p>

<p align="center">
  <img width="1100" alt="DSH Claude TUI 终端预览" src="./docs/assets/terminal-preview.svg" />
</p>

> [!NOTE]
> 这是独立社区项目，与 Anthropic 或 DeepSeek 没有隶属、背书或赞助关系。“Claude Code”仅用于标识固定版本的交互目标；仓库不包含 Anthropic 源代码。详见[商标与兼容性声明](./DISCLAIMER.md)。

## 一条命令开始

尚未发布的 `0.1.7` 候选版本需要 Node.js **22.x 的 22.19+，或 24.2+**（`^22.19.0 || >=24.2.0`）。候选版本会在修改 DSH Home 前拒绝 Node `24.0` 和 `24.1`。

```bash
npx --yes --legacy-peer-deps dsh-claude-tui
```

这条命令会安装并进入 npm `latest` 标签指向的 TUI，不要求全局安装 `dsh`、拉取仓库、安装 pnpm 或手工创建 profile。如需精确固定当前已发布版本，在包名后添加 `@0.1.6`。

`legacy-peer-deps` 用于避免 npm 花费大量时间求解本 TUI 不使用的上游 Web UI peer。它会跳过 peer 冲突校验；本版本显式包含必需的 TUI 服务，并固定 DSH 依赖。安装包验证会检查完整的 `npm ls --all` 依赖树，拒绝 missing、invalid 或冲突依赖。普通 `npx dsh-claude-tui` 也通过了标准 npm peer 求解验证，但冷安装可能需要数分钟。该参数不改变 DSH 运行版本或 TUI 行为。

真实模型请求需要所选 DSH Provider 的凭据。使用 `/provider` 查看或录入凭据，使用 `/model`（或 `Option+P` / `Alt+P`）切换 DSH 提供的模型与 effort。

如果会反复使用：

```bash
npm install --global --legacy-peer-deps dsh-claude-tui@0.1.6
dshtui
```

全局安装会同时提供短命令 `dshtui` 和正式命令 `dsh-claude-tui`。使用 `dshtui --resume` 打开 Session 选择器，或用 `--resume <session-id>` 精确恢复。

## 适配 DSH 0.2.0-rc.2（尚未发布）

`0.1.7` 源码候选版本把 Harness 固定到 `0.2.0-rc.2`，要求 Node `^22.19.0 || >=24.2.0`；外部运行时须满足 `>=0.2.0-rc.2 <0.2.1` 并通过行为探针。已发布的 TUI `0.1.6` 仍使用 DSH `0.1.2-rc.1`；上面的 npm 命令安装已发布版本，不会安装本候选版本。Node 门禁变更后的本地 macOS 完整检查与普通安装检查均已通过，[适配记录](./docs/harness-0.2.0-rc.2-adaptation.md)记录实测结果及 Ubuntu CI 发现的 Node 24.0 子进程失败。

- 实时回复保留 Agent assistant-stream 事件；最终回复、用量与计时从 V4 Session 聚合事件回放，工具结果采用 V4 的 tool-role 消息格式。
- 模型选择通过 setup 显式接收 Agent；命令图片采用带类型的附件信封，Profile 保留 `personaPrefix`。
- Provider 配置读取 DSH 已解析的设置表单，文档更新后刷新；安装包测试采用 API Key 的 Messages 协议并验证认证字段。
- 保留 Claude Code `2.1.227` 参考布局、配色、键盘操作、审批、结构化问题、图片输入、计划模式和会话选择器。
- macOS 文件监听默认采用 1 秒轮询，保留 skills、settings 和 profile 的自动更新，规避原生监听器退出挂起；显式设置的 `CHOKIDAR_USEPOLLING` / `CHOKIDAR_INTERVAL` 优先。
- PTC 使用共享 DSH base bundle 提供的受沙箱约束的 Node 子进程运行时；本版本仍保留 `native`、`ptc` 和 `both` 工具模式。
- 生产依赖图与[官方中英文文档镜像](./docs/upstream/dsh/README.md)以同一精确版本为目标；镜像不进入 npm 安装包，原始文件清单由镜像索引记录。

从本候选版本的 checkout 运行：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
DSH_HOME=/tmp/dsh-claude-tui-0.2.0-rc.2 DSH_CLAUDE_TUI_RUNTIME=bundled node lib/cli.js
```

> [!WARNING]
> DSH 现使用 V4 Session。受支持的旧日志迁移为新文件并保留原件；升级后的会话不能由旧版 Harness 读取。跨版本测试请使用独立 Home。可选 SQLite Session 后端已在 `0.1.2` 移除，使用过该后端的旧会话需先用原运行时导出；SQLite 查询和索引存储是另一项服务。

完整变化见[官方 0.2.0-rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)与[适配记录](./docs/harness-0.2.0-rc.2-adaptation.md)。[0.1.5 记录](./docs/harness-0.1.5-rc.2-adaptation.md)保留此前验证结论。上游 Web 文件上传、预览和侧栏功能不代表本 TUI 已提供对应界面；更新的 `0.2.1-alpha` 系列不在本候选版本的适配目标内。

## 你能获得什么

| 方面 | 用户可见能力 |
| --- | --- |
| 熟悉的终端 | Claude 风格欢迎面板、输入框、菜单、对话记录、状态栏、审批、问题和 Agent 状态 |
| 真实 Harness | DSH 管理的模型、持久化 Session、命令、审批策略、工具、结构化问题与子代理 |
| 实时模型配置 | Provider/model 列表、DSH 暴露的 effort 级别、默认值保存、API Key 掩码录入和凭据来源 |
| 高效输入 | 多行编辑、图片粘贴、提交或 steer、中断、历史搜索、斜杠补全和有边界的 `@` 文件补全 |
| 清晰的执行状态 | reasoning、工具调用/结果、缓存命中率、Token、TTFT、吞吐率和 turn 结果 |
| Session 与 Agent | 新建/恢复 Session、安全 flush、前后台子代理和活动 Agent roster |
| 可验证运行环境 | 欢迎面板显示真实 TUI/Harness 版本、system/bundled 来源、DSH Home 与工具模式 |

TUI 从 DSH 读取能力，不写死模型、effort、凭据或审批行为。Harness 是运行能力的事实来源；项目不会模拟 Claude 私有的云服务、账号状态、模型行为或权限语义。

## 常用操作

| 按键或命令 | 作用 |
| --- | --- |
| `Enter` | 空闲时提交，运行时 steer |
| `Shift+Enter` | 换行 |
| `Ctrl+V` | 粘贴剪贴板图片；macOS 上 `Command+V` 仍粘贴文本 |
| `Backspace` | 文字输入为空时删除最后一张待发图片 |
| `Shift+Tab` | 切换当前 Session 的 DSH plan mode |
| `Esc` / `Ctrl+C` | 中断当前 turn |
| `Ctrl+R` | 搜索历史 prompt |
| `Ctrl+O` | 展开或收起工具详情 |
| `Option+P` / `Alt+P` 或 `/model` | 打开 DSH 实时模型选择器 |
| `/provider` | 查看或更新 DSH Provider 凭据 |
| `Left Arrow` | 显示或隐藏活动 Agent roster |
| `Ctrl+D` | 空输入时连续按两次，安全退出 |

在 TUI 中运行 `/help` 可查看当前命令列表。

## 兼容已有 DSH 环境

默认启动逻辑让用户无需预先选择安装策略：

1. 优先复用所选 `$DSH_HOME` 已关联的兼容 DSH，或 `PATH` 中来源可验证的 `dsh`；
2. 在不继承凭据的临时 Home 中执行兼容探针；
3. 没有外部候选通过时，自动使用包内由 shrinkwrap 固定的 DSH `0.2.0-rc.2`。

本源码候选版本的兼容性同时要求版本满足 `>=0.2.0-rc.2 <0.2.1` 并通过行为探针。Home 可安全共享时，已有凭据、Session、设置和无关 profile 会继续可用。启动器不会覆盖不属于自己的 profile；隐式默认 Home 不安全时可退回 `~/.dsh-claude-tui` 并显示提示，显式 `DSH_HOME` 冲突则给出可操作错误，不会偷偷移动数据。

| 变量 | 行为 |
| --- | --- |
| `DSH_CLAUDE_TUI_RUNTIME=auto` | 默认：先尝试兼容的系统 DSH，再使用包内 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=system` | 必须使用兼容的外部 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=bundled` | 始终使用包内 DSH |
| `DSH_HOME=/path` | 指定 DSH 数据 Home |
| `DSH_TOOLS_MODE=native\|ptc\|both` | DSH 工具呈现模式，对应 Standard、PTC、Both |

完整选择、所有权和恢复规则见[启动器环境兼容说明](./docs/launcher-environment-compatibility.md)。

## 兼容与验证

主要交互目标是已观测的 Claude Code `2.1.227` TUI；`Ctrl+V` 后出现 `[Image #1]` 的输入器行为另行实测自 Claude Code `2.1.237`。现有参考集包含 **24** 个独立捕获的 PTY 帧与 **22** 个自动视觉/语义锚点。本次适配重新运行既有比较，没有新增 Claude Code 捕获基线。

- Node 门禁变更后的 macOS arm64 检查中，Node `24.16.0` 完整检查为 14 个文件、**179 通过、1 跳过**；Node `22.23.3` 普通 npm peer 求解安装包检查为 **12 通过、1 跳过**。Node `24.0`/`24.1` 已被排除：此前 macOS 启动检查没有覆盖后来 Ubuntu PTC 测试发现的子进程 runner 失败。详细结果与范围见[适配记录](./docs/harness-0.2.0-rc.2-adaptation.md)。
- 本轮测试覆盖 true-color、xterm-compatible 的 `80x24`、`100x30` 布局、图片与命令附件、审批、问题、计划模式按键和前后台子代理。
- 安装产物检查覆盖全新 npm 安装、两个命令入口、包内与独立外部运行时探针、经本地 DeepSeek Messages/Files API mock 的受沙箱约束 Node PTC 工具轮次、安全退出与恢复，以及 V0/V3-to-V4 迁移和原文件字节保留。
- opt-in 真实 macOS 系统剪贴板检查已跳过。Ubuntu CI 配置为 Node `22.19.0`、`22.22.3`、`24.2.0` 和 `24.14.0`，结果由[本分支 PR checks](https://github.com/cogine-ai/dsh-claude-tui/actions?query=branch%3Acliq%2Fdsh-0.2.0-rc.2)跟踪；Node `24.2.0` 的运行资格需以完整 Ubuntu 检查通过为依据。

Windows 启动、junction、信号转发、VT 输入、依赖预编译件和 STA 图片剪贴板路径均已实现，固定的 DSH 上游也有原生 Windows gate。但本 TUI 自己的 CI 仍只运行 Ubuntu，尚无 Windows packed-TUI/ConPTY UAT。因此 Windows 目前只是“已有实现但尚未认证”的目标，不能称为当前版本支持的发布平台。详见[完整视觉与语义资格报告](./docs/visual-qualification-2.1.227.md)和[制品加固基线](./docs/release-hardening-v0.1.0.md)。

## 一起把它做得更好

这个项目不应只是覆盖在运行时上的一层主题。我们的目标是做一个快速、可审查、尊重 DSH 语义的终端客户端，也让开发者能在这里共同改善 Harness 的使用体验。

参与不要求先读懂整个运行时，可以从这些入口开始：

| 参与方向 | 适合第一份贡献的任务 |
| --- | --- |
| 终端资格验证 | 在明确的终端、系统和窗口尺寸下复现布局或快捷键问题 |
| 运行时集成 | 为某个 DSH 命令、Session、审批或子代理边界补一项聚焦测试 |
| 交互设计 | 在不掩盖未支持状态的前提下，改善图片输入、引用、补全或 Session 管理 |
| 稳定性 | 减少启动歧义、强化安装包验证，或把现场问题变成确定性 fixture |
| 文档与语言 | 改善上手说明、解释架构边界，或保持中英文文档同步 |
| 无障碍 | 改善无颜色模式、纯键盘流程、读屏输出或窄终端表现 |

先阅读[贡献指南](./CONTRIBUTING.zh-CN.md)，然后提交一个[边界清晰的 issue](https://github.com/cogine-ai/dsh-claude-tui/issues/new/choose) 或 pull request。较大的改动请先说明用户问题和证据，让维护者与贡献者一起确定合适的实现边界。

## 本地开发

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

发布门禁依次执行 TypeScript 检查、干净的生产构建和完整串行 Vitest。视觉一致性修改必须附独立捕获的参考证据，或明确记录 Harness 语义边界；运行时修改必须验证安装包路径，不能只证明源码 import 可用。

近期可参与方向包括更丰富的图片输入、文件与 Session 引用补全、更完整的 Session 管理、更多 plan/todo/后台任务状态，以及更多终端和操作系统资格验证。这些是贡献方向，不代表功能已经交付。

## License

项目原创代码采用 [MIT License](./LICENSE)。产品名称与商标归各自权利人所有；MIT License 不授予任何第三方商标使用权。
