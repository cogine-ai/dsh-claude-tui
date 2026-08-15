<h1 align="center">DeepSeek Harness — Claude TUI</h1>

<p align="center"><strong>Claude Code muscle memory. DeepSeek Harness underneath.</strong></p>

<p align="center">English · <a href="./README.zh-CN.md">简体中文</a></p>

<p align="center">
  An unofficial, high-fidelity Claude Code-style terminal interface for DeepSeek Harness,<br />
  reconstructed from real PTY captures and verified cell by cell.
</p>

<p align="center">
  <a href="https://github.com/cogine-ai/dsh-claude-tui/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/cogine-ai/dsh-claude-tui?style=flat-square&logo=github" /></a>
  <a href="https://github.com/cogine-ai/dsh-claude-tui/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/cogine-ai/dsh-claude-tui/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/dsh-claude-tui"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-claude-tui?style=flat-square&logo=npm" /></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-4d6bfe?style=flat-square" /></a>
  <img alt="Claude Code 2.1.227 target" src="https://img.shields.io/badge/Claude_Code-2.1.227-d77757?style=flat-square" />
  <img alt="66 tests" src="https://img.shields.io/badge/tests-66%2F66-4eba65?style=flat-square" />
</p>

<p align="center">
  <img width="1100" alt="DeepSeek Harness Claude TUI terminal preview" src="./docs/assets/terminal-preview.svg" />
</p>

> [!NOTE]
> This is an independent community project. It is not affiliated with, endorsed by, or sponsored by Anthropic or DeepSeek. “Claude Code” identifies the version-pinned compatibility target; no Anthropic source code is included. See the [trademark and compatibility notice](./DISCLAIMER.md).

## Why this exists

DeepSeek Harness has a composable Agent, Session, tool, approval, question, and subagent runtime. Claude Code has a terminal workflow many developers already know by muscle memory.

This plugin joins those two ideas without forking Harness core:

- **Feels familiar:** Claude-shaped shell, prompt, menus, transcript, approvals, questions, and agent states.
- **Runs on Harness:** live Harness models, durable Sessions, commands, permissions, tools, and subagents.
- **Proves fidelity:** 23 frames captured from a real Claude Code `2.1.227` PTY; 21 are automated comparison anchors.
- **Tests the terminal, not a mockup:** buffer choice, cell geometry, RGB styles, hardware cursor, and interaction transitions.

It is an external Harness bundle—not a web skin and not a hardcoded terminal recording.

## Try it

Prerequisite: Node.js `22.19+` or `24+`. The command carries its qualified
DeepSeek Harness version; no global `dsh`, repository checkout, pnpm install,
or manual profile setup is required.

The current published baseline is [`dsh-claude-tui@0.1.0`](https://www.npmjs.com/package/dsh-claude-tui/v/0.1.0).

```bash
npx dsh-claude-tui
```

For repeat use, an optional global installation exposes the same launcher:

```bash
npm install --global dsh-claude-tui@0.1.0
dsh-claude-tui
```

Sending a real model request requires the credentials for the Harness model provider you select.

The launcher uses its pinned Harness executable even when another `dsh` is on
`PATH`, while deliberately sharing the selected `$DSH_HOME` so existing
credentials, Sessions, settings, and unrelated profiles remain available. It
owns only the `claude-tui` profile's bundle registration. If that profile name
already exists without the launcher's ownership marker, startup fails with a
recovery message instead of adopting or overwriting it.

Harness is still pre-release and does not promise migration between every
on-disk state version. The bundled `0.1.0-rc.6` runtime rejects incompatible
Session or storage formats rather than migrating them. If an existing
`$DSH_HOME` was produced by an incompatible Harness build, use an isolated
home (for example `DSH_HOME=~/.dsh-claude-tui npx dsh-claude-tui`) and move
only data through an explicitly supported Harness migration path.

Do not run different Harness versions concurrently against the same
`$DSH_HOME`: Harness owns a shared profile-module fallback and either process
may reconcile it for its own dependency tree. Sequential use is qualified;
for concurrent use, give this launcher an isolated `DSH_HOME`.

## What already works

| Surface | Implemented behavior |
| --- | --- |
| Main shell | normal-buffer scrollback, Claude orange logo, responsive header, editor, status footer |
| Prompt | multiline editing, submit/steer, cancellation, reverse history search |
| Completion | slash commands and bounded `@` workspace file mentions |
| Models | live DSH provider/model catalog, exact advertised effort levels, current-Agent and saved-default selection |
| Providers | live DSH credential source/writability state, masked API-key entry, narrow first-run setup |
| Transcript | user, assistant, reasoning, tool call/result, usage, request and turn outcomes |
| Protocols | real Harness approval and structured-question providers |
| Agents | foreground/background subagent states, expandable output, active-agent roster |
| Sessions | create, exact-id resume, interactive picker, graceful flush and terminal restoration |

Useful controls:

| Key | Action |
| --- | --- |
| `Enter` | submit while idle or steer a running Agent |
| `Shift+Enter` | insert a newline |
| `Esc` / `Ctrl+C` | interrupt a running turn |
| `Ctrl+R` | search prompt history |
| `Ctrl+O` | expand or compact tool details |
| `Option+P` / `Alt+P` | open the live DSH model picker |
| `Left Arrow` | hide or show the active-agent roster |
| `Ctrl+D` | press twice on an empty prompt to exit cleanly |

Use `/model` for the same model picker and `/provider` to inspect or update credentials exposed by DSH. Model names, effort levels, defaults, credential references, source priority, and writability are never hardcoded by this TUI. See the [model/provider interaction boundary](./docs/model-provider-interactions.md).

## Fidelity

Verified against Claude Code `2.1.227` in a true-color xterm-compatible PTY:

- **23** reference frames and **21** automated visual/semantic anchors.
- **66/66** tests, including terminal behavior at `80x24` and `100x30`.
- Real Harness runs for approvals, questions, and foreground/background subagents.
- One intentional difference: a blank top row prevents logo clipping.

[Full qualification report](./docs/visual-qualification-2.1.227.md)

## Architecture

```text
@deepseek-ai/dsh-base
  → dsh-claude-tui bundle
    → startup argument service
    → worker-thread code runtime
    → one terminal-owned root Agent
      → durable Session event projection
      → pi-tui normal-buffer renderer
      → approval + question protocol adapters
      → subagent lifecycle + active-run roster
```

The plugin waits for Loader settlement, binds every event to the exact root Agent, delegates unknown slash commands to Harness, and reverses registrations before restoring raw terminal state.

## Compatibility

Targets the observed Claude Code `2.1.227` TUI only. Harness remains the source of truth for runtime data and capabilities; unsupported Claude-only states are not simulated. New versions require requalification.

The `v0.1.0` qualification matrix targets macOS arm64 and Linux x64 with a
true-color xterm-compatible terminal. The Windows launcher path is present but
is not yet release-qualified.

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

The check gate runs TypeScript no-emit validation, all Vitest terminal tests, and the production build.

To refresh the reference corpus with the locally installed Claude Code `2.1.227` executable:

```bash
corepack pnpm capture:claude-reference -- --cwd /path/to/a/trusted/workspace
```

Dynamic capture scenarios use an isolated Claude config, a dummy key, and a loopback-only Anthropic mock. They make no external model request and do not require a user API key.

## Roadmap

**v0.1.0 — published baseline**

- publishes a clean, shrinkwrap-pinned npm artifact;
- makes `npx dsh-claude-tui` the complete install-and-launch path;
- qualifies first-run setup, repeat-run idempotence, packed-tarball execution, and real DeepSeek access.

The completed qualification gates are recorded in the [v0.1.0 Release Hardening report](./docs/release-hardening-v0.1.0.md).

**Next — feedback-led v0.1.x**

- richer attachment and completion surfaces;
- broader session management and rename flows;
- additional plan, todo, and background-job states;
- more terminal emulators and operating-system qualification.

Issues and focused pull requests are welcome. Visual-parity changes should include an independently captured reference or an explicit, documented Harness-semantic boundary.

## License

Original project code is available under the [MIT License](./LICENSE). Product names and marks remain the property of their respective owners; the MIT License does not grant rights to third-party trademarks.
