# 参与 DSH Claude TUI

感谢你一起改善 DeepSeek Harness 的终端体验。代码、可复现的终端报告、测试、文档、设计分析和翻译都属于有价值的贡献。

[English](./CONTRIBUTING.md)

## 开始之前

- 新建 issue 前先搜索现有记录。
- 边界清晰的修复有证据、有可测试结果时，可以直接提交 pull request。
- 较大的交互、架构或依赖变化请先开 issue，说明用户问题、已观测行为和建议修改的边界。
- 不要在同一 PR 中夹带无关清理；越聚焦越容易审查和发布。

本项目是独立兼容客户端。请勿提交复制的私有源码、内部 prompt、凭据、Session 数据或未脱敏的终端录屏；独立行为观察和自行制作的 fixture 非常欢迎。

## 适合第一份贡献的任务

不需要先理解全部 DSH package，可以从这些任务开始：

- 记录终端名称、操作系统、尺寸和完整按键，复现一个终端问题；
- 为命令、审批、问题、Session 或子代理状态补一个确定性测试；
- 改善无颜色、纯键盘、窄终端或读屏体验；
- 澄清安装和恢复指引；
- 保持中英文文档同步；
- 在新的终端或操作系统上验证已有流程。

如果还没有对应 issue，请使用仓库的 issue 模板。一个小而准确的复现往往就是最好的第一份贡献。

## 本地环境

需要：

- Node.js `22.19+` 或 `24+`；
- Corepack；
- 用于交互检查的 xterm-compatible 终端。

```bash
git clone https://github.com/cogine-ai/dsh-claude-tui.git
cd dsh-claude-tui
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

`pnpm check` 会执行 TypeScript 检查、干净的生产构建和完整串行 Vitest。绝大多数测试不需要 Provider 凭据。不要提交凭据或已有数据的 DSH Home。

发布维护者还会运行 `corepack pnpm test:bundle:default`，单独验证普通 npm 的 peer 求解。该门禁刻意不使用 README 中的规避参数；npm 10 面对 rc2 依赖图时可能耗时接近十分钟。日常 CI 则使用同样覆盖完整、但基于已固定 TUI 闭包的 packed-install 路径。

从仓库快速启动：

```bash
corepack pnpm build
node lib/cli.js
```

实验不同 Harness 版本时使用独立 Home：

```bash
DSH_HOME=/tmp/dsh-claude-tui-dev DSH_CLAUDE_TUI_RUNTIME=bundled node lib/cli.js
```

不要让多个 Harness 版本并发使用同一个 Home；预发布阶段的存储迁移可能不兼容。

## 代码地图

| 范围 | 主要文件 |
| --- | --- |
| 启动与运行时选择 | `src/cli.ts`、`src/launch-plan.ts`、`src/runtime-discovery.ts`、`src/runtime-probe.ts` |
| DSH 托管 profile | `src/managed-profile.ts`、`cordis.patch.yml` |
| 插件组合 | `src/index.ts`、`src/startup.ts` |
| 终端交互 | `src/app.ts`、`src/surface.ts`、`src/dialogs.ts`、`src/transcript.ts` |
| 模型与 Provider | `src/model-picker.ts`、`src/providers.ts` |
| Session 体验 | `src/session-picker.ts` |
| 安装制品验证 | `tests/bundle.spec.ts`、`tests/packed-launcher.spec.ts` |
| 参考资格验证 | `docs/visual-qualification-2.1.227.md`、`scripts/` |

## 不同修改需要的证据

| 修改类型 | 最低有效证据 |
| --- | --- |
| 运行时或 DSH API | 类型检查、聚焦服务测试、适用时的行为兼容探针，以及安装包覆盖 |
| 启动器或 profile | system/bundled 选择、Home 所有权场景和 tarball 运行 |
| 终端交互 | 明确窗口尺寸的 headless terminal 测试与对应按键序列 |
| 视觉一致性 | 独立捕获的参考，或对 Harness 语义边界的书面说明 |
| 仅文档 | 链接有效、命令符合当前代码、中英文承诺一致 |

测试应验证用户可见行为或服务契约，而不是私有实现细节。影响发布包的修改只证明源码 import 成功是不够的。

## Pull request 检查单

- [ ] PR 说明用户问题和选择的修改边界。
- [ ] 修改保持聚焦，没有无关格式化或依赖波动。
- [ ] 新行为有确定性覆盖；无法测试时说明具体原因。
- [ ] `corepack pnpm check` 通过。
- [ ] 用户行为变化对应的 README 和中英文文档保持一致。
- [ ] 不包含凭据、私有数据、生成的 Home 或专有材料。
- [ ] 已交付、实验性、未测试和计划中的行为标记诚实。

## 报告问题

最容易处理的问题报告包含：

1. `dsh-claude-tui --version` 和欢迎面板显示的 Harness 版本；
2. Node.js 版本、系统/架构、终端名称和终端尺寸；
3. 运行时是 `bundled` 还是 `system`，以及是否显式设置 `DSH_HOME`；
4. 完整按键或命令、预期结果与实际结果；
5. 安全且已脱敏的最小截图、录屏或日志。

不要上传 API Key、凭据文件、完整 Session 数据库或私有仓库内容。

## 审查原则

维护者主要审查三件事：是否忠于已观测的交互目标、是否忠于真实 DSH 语义，以及发布制品是否有运行证据。三者冲突时，DSH 正确性和对用户透明的反馈优先于视觉模仿。

正式发布由维护者执行；贡献者不应修改 package 所有权、发布 tag 或发布凭据。
