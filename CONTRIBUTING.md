# Contributing to DSH Claude TUI

Thank you for helping build a better terminal experience for DeepSeek Harness. Contributions of code, reproducible terminal reports, tests, documentation, design reasoning, and translations are all valuable.

[简体中文](./CONTRIBUTING.zh-CN.md)

## Before you start

- Search existing issues before opening a new one.
- For a focused fix, open a pull request when you have evidence and a testable outcome.
- For a large interaction, architecture, or dependency change, open an issue first. Describe the user problem, the observed behavior, and the boundary you propose changing.
- Keep unrelated cleanup out of the same pull request. Small reviews reach users faster.

This project is an independent compatibility client. Do not submit copied proprietary source, private prompts, credentials, session data, or unredacted terminal captures. Behavioral observations and independently produced fixtures are welcome.

## Good first contributions

You do not need to understand every DSH package. Useful starting points include:

- reproducing a terminal issue with the terminal name, OS, dimensions, and exact keystrokes;
- adding one deterministic test for a command, approval, question, Session, or subagent state;
- improving no-color, keyboard-only, narrow-terminal, or screen-reader behavior;
- clarifying setup and recovery guidance;
- keeping the English and Chinese docs synchronized;
- qualifying an existing flow on a new terminal or operating system.

If an issue is not yet filed, use the repository's issue chooser. A small reproduction is often the best first contribution.

## Local setup

Requirements:

- Node.js `22.19+` or `24+`;
- Corepack;
- an xterm-compatible terminal for interactive checks.

```bash
git clone https://github.com/cogine-ai/dsh-claude-tui.git
cd dsh-claude-tui
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

`pnpm check` runs TypeScript validation, a clean production build, and the complete serial Vitest suite. Most tests do not need a provider credential. Never commit credentials or a populated DSH Home.

Release maintainers also run `corepack pnpm test:bundle:default` to qualify plain npm peer resolution. That gate intentionally does not use the README workaround and can take close to ten minutes on npm 10 with the rc2 graph; routine CI uses the equally complete packed-install path with the pinned TUI closure.

For a quick local launch from the repository:

```bash
corepack pnpm build
node lib/cli.js
```

Use an isolated Home when experimenting with Harness versions:

```bash
DSH_HOME=/tmp/dsh-claude-tui-dev DSH_CLAUDE_TUI_RUNTIME=bundled node lib/cli.js
```

Do not point multiple Harness versions at one Home concurrently. Pre-release storage migrations may be incompatible.

## Where things live

| Area | Main files |
| --- | --- |
| Launcher and runtime selection | `src/cli.ts`, `src/launch-plan.ts`, `src/runtime-discovery.ts`, `src/runtime-probe.ts` |
| Managed DSH profile | `src/managed-profile.ts`, `cordis.patch.yml` |
| Plugin composition | `src/index.ts`, `src/startup.ts` |
| Terminal interaction | `src/app.ts`, `src/surface.ts`, `src/dialogs.ts`, `src/transcript.ts` |
| Model and provider UX | `src/model-picker.ts`, `src/providers.ts` |
| Session UX | `src/session-picker.ts` |
| Installed-artifact proof | `tests/bundle.spec.ts`, `tests/packed-launcher.spec.ts` |
| Reference qualification | `docs/visual-qualification-2.1.227.md`, `scripts/` |

## Evidence expected by change type

| Change | Minimum useful evidence |
| --- | --- |
| Runtime or DSH API | Typecheck, focused service test, behavioral compatibility probe when applicable, and installed-package coverage |
| Launcher or profile | System/bundled selection tests, Home ownership cases, and packed-tarball execution |
| Terminal interaction | Headless terminal test at a named geometry plus the relevant key sequence |
| Visual parity | Independently captured reference or a written explanation of the Harness-semantic boundary |
| Docs only | Checked links, commands that match current code, and synchronized translated claims |

Tests should assert user-visible or service-contract behavior, not private implementation details. A source-only import is not sufficient proof for a change that affects the published package.

## Pull request checklist

- [ ] The pull request explains the user problem and the chosen boundary.
- [ ] The change is focused and does not include unrelated formatting or dependency churn.
- [ ] New behavior has deterministic coverage, or the pull request explains why a test is not practical.
- [ ] `corepack pnpm check` passes.
- [ ] README and English/Chinese docs remain aligned where user-facing behavior changed.
- [ ] No credentials, private data, generated Homes, or proprietary material are included.
- [ ] Shipped, experimental, untested, and planned behavior are labeled honestly.

## Reporting a bug

The most actionable report contains:

1. `dsh-claude-tui --version` and the Harness version shown in the welcome panel;
2. Node.js version, OS/architecture, terminal name, and terminal dimensions;
3. whether the runtime is `bundled` or `system`, and whether `DSH_HOME` is explicit;
4. exact keystrokes or command, expected result, and actual result;
5. a minimal redacted capture or log when safe.

Do not attach API keys, credential files, full Session databases, or private repository content.

## Review principles

Maintainers review for three things: fidelity to the observed interaction target, fidelity to real DSH semantics, and evidence that the published artifact works. When those goals conflict, DSH correctness and transparent user feedback take priority over visual imitation.

Release publication remains a maintainer action. Contributors should not change package ownership, publish tags, or release credentials.
