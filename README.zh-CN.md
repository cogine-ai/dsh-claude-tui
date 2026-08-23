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
  <img alt="DeepSeek Harness rc2" src="https://img.shields.io/badge/DSH-0.1.1--rc.2-536af5?style=flat-square" />
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
  <img alt="141 tests" src="https://img.shields.io/badge/tests-141%2F141-4eba65?style=flat-square" />
</p>

<p align="center">
  <img width="1100" alt="DSH Claude TUI 终端预览" src="./docs/assets/terminal-preview.svg" />
</p>

> [!NOTE]
> 这是独立社区项目，与 Anthropic 或 DeepSeek 没有隶属、背书或赞助关系。“Claude Code”仅用于标识固定版本的交互目标；仓库不包含 Anthropic 源代码。详见[商标与兼容性声明](./DISCLAIMER.md)。

## 一条命令开始

需要 Node.js `22.19+` 或 `24+`。

```bash
npx --yes --legacy-peer-deps dsh-claude-tui
```

这条命令会安装并进入 npm `latest` 标签指向的 TUI，不要求全局安装 `dsh`、拉取仓库、安装 pnpm 或手工创建 profile。如需精确固定本次版本，在包名后添加 `@0.1.5`。

`legacy-peer-deps` 是针对 rc2 上游密集 peer 图的临时 npm 安装规避。它让 npm 跳过 peer 冲突校验，并使用本版本显式固定的 rc2 TUI 闭包，其中包含必需的 authorization 服务和上游已发布 Web 包传递暴露出的 React 18 兼容 peer。只应对本文所示、已经通过 packed-install 验证的发布版本使用该路径：发布 gate 会执行完整的 `npm ls --all`，并拒绝任何 missing、invalid 或冲突依赖。普通 `npx dsh-claude-tui` 仍然兼容，但 npm 10 冷安装可能花接近十分钟求解本 TUI 不使用的 Web UI peer。该参数不改变 DSH 运行版本或 TUI 行为。

真实模型请求需要所选 DSH Provider 的凭据。使用 `/provider` 查看或录入凭据，使用 `/model`（或 `Option+P` / `Alt+P`）切换 DSH 提供的模型与 effort。

如果会反复使用：

```bash
npm install --global --legacy-peer-deps dsh-claude-tui@0.1.5
dshtui
```

全局安装会同时提供短命令 `dshtui` 和正式命令 `dsh-claude-tui`。使用 `dshtui --resume` 打开 Session 选择器，或用 `--resume <session-id>` 精确恢复。

## v0.1.5：DeepSeek Harness 0.1.1-rc.2

本版本将完整的包内运行时固定到 DeepSeek Harness `0.1.1-rc.2`，并把外部运行时最低要求提升为 `>=0.1.1-rc.2 <0.1.2`。

- `Shift+Tab` 现在执行 DSH 的真实 `/plan` 或 `/plan off` 命令。安装包 PTY 测试覆盖了 macOS 传统序列 `ESC [ Z`，并验证同一 Session 能恢复对应的 `plan/mode` 状态。Plan mode 只提供引导，不会改变独立的工具模式或审批策略。
- `Ctrl+V` 现在会读取一张桌面剪贴板图片，并在输入器中加入 Claude 风格的 `[Image #N]` 标记；macOS 上的 `Command+V` 仍然只是普通文本粘贴。文字为空时，Backspace 会删除最后一张待发图片，`Ctrl+C` 会清空整份图片/文字草稿。
- 图片提交先经过 rc2 `ctx.attachments` 校验与持久化，Session 消息只记录耐久引用；支持图片的斜杠命令继续使用附件感知接口 `execute(agent, line, images, signal)`。平台入口分别为 macOS `osascript`、Windows STA PowerShell，以及 Linux `wl-paste`/`xclip`，格式限于 DSH 支持的 PNG、JPEG、WebP 与 GIF。
- 运行时资格探针除默认模型、Agent、命令和 Session 外，还会通过附件存储真实写入并读回一张 PNG；仅版本字符串匹配的非兼容运行时不能通过。
- 包内依赖图现已显式提供 rc2 新要求的 `@deepseek-ai/dsh-authorization` peer，以及原有 DeepSeek 与 React 18 peer；发布 shrinkwrap 只存在一条 DSH 版本线：`0.1.1-rc.2`。
- 上游 rc1 新增实验性视觉模型、Bubblewrap 越界修复和问题回答多行编辑；rc2 增加 Files API 图片复用和按模型要求预处理图片。本 TUI 的安装包图片 gate 现在会覆盖剪贴板读取、耐久存储、Session 恢复、一次 Files API 上传和带 `file_id` 的 chat request；测试只连接本地 mock，不访问生产 Provider。

> [!WARNING]
> rc8 这一版本线引入了不兼容的 SQLite 持久化格式，rc2 延续自该版本线。不要让不同 Harness 版本并发使用同一个 `$DSH_HOME`；除非 DeepSeek Harness 明确给出受支持的迁移路径，也不要降级该 Home。测试其他版本请使用独立 Home。

上游完整变化见 DeepSeek Harness [rc1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.1) 与 [rc2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.1-rc.2) 官方发布说明。本项目刻意缩小承诺范围：这里只描述该 TUI 实际组合并验证的能力。

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
3. 没有外部候选通过时，自动使用包内由 shrinkwrap 固定的 DSH `0.1.1-rc.2`。

兼容性同时要求版本满足 `>=0.1.1-rc.2 <0.1.2` 并通过行为探针。Home 可安全共享时，已有凭据、Session、设置和无关 profile 会继续可用。启动器不会覆盖不属于自己的 profile；隐式默认 Home 不安全时可退回 `~/.dsh-claude-tui` 并显示提示，显式 `DSH_HOME` 冲突则给出可操作错误，不会偷偷移动数据。

| 变量 | 行为 |
| --- | --- |
| `DSH_CLAUDE_TUI_RUNTIME=auto` | 默认：先尝试兼容的系统 DSH，再使用包内 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=system` | 必须使用兼容的外部 DSH |
| `DSH_CLAUDE_TUI_RUNTIME=bundled` | 始终使用包内 DSH |
| `DSH_HOME=/path` | 指定 DSH 数据 Home |
| `DSH_TOOLS_MODE=native\|code\|both` | DSH 工具呈现模式，对应 Standard、PTC、Both |

完整选择、所有权和恢复规则见[启动器环境兼容说明](./docs/launcher-environment-compatibility.md)。

## 兼容与验证

主要交互目标是已观测的 Claude Code `2.1.227` TUI；`Ctrl+V` 后出现 `[Image #1]` 的输入器行为另行实测自 Claude Code `2.1.237`。当前资格范围包括：

- macOS arm64 与 Linux x64；
- true-color、xterm-compatible 终端；
- **24** 个独立捕获的 PTY 参考帧，**22** 个自动视觉/语义锚点；
- 默认 gate **141/141** 个测试，覆盖 `80x24`、`100x30`、剪贴板/附件失败与取消路径、rc2 命令信封和真实 profile 探针、tarball 安装、真实 PTY 中的 macOS `Shift+Tab`、两个命令入口、Session 恢复、审批、问题和前后台子代理。另有一个 opt-in macOS 系统剪贴板 gate，会把安装包图片送过 DSH 存储和本地 Files API/chat mock。

Windows 启动、junction、信号转发、VT 输入、依赖预编译件和 STA 图片剪贴板路径均已实现，固定的 DSH rc2 上游也有原生 Windows gate。但本 TUI 自己的 CI 仍只运行 Ubuntu，尚无 Windows packed-TUI/ConPTY UAT。因此 Windows 目前只是“已有实现但尚未认证”的目标，不能称为当前版本支持的发布平台。详见[完整视觉与语义资格报告](./docs/visual-qualification-2.1.227.md)和[制品加固基线](./docs/release-hardening-v0.1.0.md)。

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
