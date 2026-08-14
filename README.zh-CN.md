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
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-4d6bfe?style=flat-square" /></a>
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
  <img alt="53 tests" src="https://img.shields.io/badge/tests-53%2F53-4eba65?style=flat-square" />
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
- **高保真可证明：** 从真实 Claude Code `2.1.227` PTY 独立捕获 23 个参考帧，其中 21 个接入自动对比。
- **验证的是终端，不是效果图：** 比较 buffer、字符格坐标、RGB 样式、硬件光标和状态转换。

它是一个真正的 Harness 外部 bundle，不是网页换肤，也不是预录的终端动画。

## 立即体验

前置条件：可用的 DeepSeek Harness CLI、Node.js `24` 和 pnpm `11`。

```bash
git clone https://github.com/cogine-ai/dsh-claude-tui.git
cd dsh-claude-tui

corepack pnpm install --frozen-lockfile
corepack pnpm check

dsh plugin --profile claude-tui add "$PWD"
DSH_TOOLS_MODE=code dsh --profile claude-tui
```

真正向模型发送请求时，需要配置所选 Harness 模型提供方的凭证。

## 已实现

| 界面 | 当前能力 |
| --- | --- |
| 主界面 | normal-buffer 回滚、Claude 橙色图标、响应式 Header、编辑器和状态栏 |
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

- **23** 个参考帧，**21** 个自动视觉/语义锚点；
- **53/53** 个测试，包含 `80x24`、`100x30` 的终端行为；
- 真实 Harness 运行覆盖审批、问题及前台/后台子代理；
- 唯一主动差异：增加一行顶部留白，避免图标裁切。

[完整资格报告](./docs/visual-qualification-2.1.227.md)

## 兼容边界

仅覆盖已观测到的 Claude Code `2.1.227` TUI。运行数据和能力以 Harness 为准，不模拟其未提供的 Claude 私有状态；新版本需重新验证。

## 开发与验证

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

资格门会执行 TypeScript no-emit、全部 Vitest 终端测试和生产构建。

## 路线图

**现在 — v0.1.0 Release Hardening**

- 保证从干净 checkout 构建出可发布、可运行的 npm 包；
- 以 `npx dsh-claude-tui` 完成安装与启动，不再要求用户手动安装 Harness 或 profile；
- 验证首次初始化、重复启动幂等性，以及 tarball 安装后的真实运行路径。

完整范围和发布门槛见 [v0.1.0 Release Hardening 计划](./docs/release-hardening-v0.1.0.md)。

**下一步 — v0.1.0 之后**

- 更丰富的附件与补全界面；
- 更完整的 Session 管理和重命名流程；
- 更多 plan、todo 与后台任务状态；
- 覆盖更多终端模拟器与操作系统。

欢迎提交 issue 和聚焦的 pull request。涉及视觉一致性的修改，应附带独立捕获的参考证据，或明确记录 Harness 语义边界。

## License

项目原创代码采用 [MIT License](./LICENSE)。产品名称与商标归各自权利人所有；MIT License 不授予任何第三方商标使用权。
