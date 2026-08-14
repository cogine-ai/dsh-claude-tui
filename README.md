# dsh-claude-tui

A version-pinned, Claude Code-like main-screen TUI for DeepSeek Harness.

The package is an external Harness bundle, not a Web skin. It stacks after `@deepseek-ai/dsh-base`, owns raw terminal input and rendering, and drives the current Agent and Session services without forking the Harness core.

The initial compatibility target is Claude Code `2.1.227`. “Claude-like” covers observable terminal presentation and primary interaction flows; it does not claim equivalence with Claude's private model behavior, permission classifier, complete Hook runtime, cloud services, or future releases.

## Status

Runnable alpha with a version-pinned visual and semantic qualification baseline. The bundle covers application boot, session creation and picker-based resume, event-projected transcript rendering, prompt submission and steering, cancellation, reverse prompt search, slash and file-mention completion, approvals, structured user questions, foreground/background subagent presentation, and terminal restoration.

The reference corpus contains 23 independently captured Claude Code `2.1.227` frames in a true-color xterm-compatible PTY. Twenty-one frames are wired into automated candidate assertions covering the core shell, prompt and completion affordances, session picker, errors, streamed/completed responses, tools, approvals, questions, plan indication, and subagent states. The other two permission-mode frames are retained as reference-only evidence because Harness does not expose equivalent Claude permission semantics. Tests compare the observable terminal contract: buffer, cell geometry, cursor placement, stable text, and selected style runs. See [the visual qualification report](docs/visual-qualification-2.1.227.md).

The main header deliberately retains Claude Code's measured three-row orange logo. It adds one blank safety row above the logo so terminal chrome cannot visually crop it, identifies the surface as `DeepSeek Harness - Claude TUI`, and places a right-aligned official-blue `powered by dsh` badge on the working-directory row. The badge yields to the live path and disappears below 48 columns.

The visual tests are supplemented by isolated real-Harness runs for approval rejection, structured-question answers, and foreground/background subagents. Those runs use Harness's official loopback mock provider and persisted Session events; they do not require a Claude or DeepSeek API key.

This is a high-fidelity core interaction slice, not a claim that every Claude Code screen or private behavior has already been reproduced.

## Install from this checkout

Build the bundle:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Link it into an isolated Harness profile:

```sh
dsh plugin --profile claude-tui add /absolute/path/to/dsh-claude-tui
dsh --profile claude-tui
```

The profile is created under `$DSH_HOME/profiles/claude-tui`. Installing the bundle adds its `cordis.patch.yml` after `@deepseek-ai/dsh-base`; it does not modify the Harness source tree.

Useful launch forms:

```sh
dsh --profile claude-tui "inspect this repository"
dsh --profile claude-tui --resume session-123
dsh --profile claude-tui --model deepseek/deepseek-chat
```

## Implemented interaction surface

| Interaction | Behavior |
| --- | --- |
| `Enter` | Submit a follow-up while idle, or steer the running Agent |
| `Shift+Enter` | Insert a newline |
| `Esc` / `Ctrl+C` | Interrupt a running turn |
| `Ctrl+C` on an idle prompt | Clear input; press twice on an empty prompt to exit |
| `Ctrl+R` | Search submitted prompts in reverse chronological order |
| `Ctrl+O` | Toggle compact and expanded tool transcript detail |
| `Left Arrow` | Hide or show the active-subagent roster when subagents are running |
| `Ctrl+L` | Force a full redraw |
| `Ctrl+D` on an idle, empty prompt | Show the exit confirmation; press again within the measured 800 ms window to flush the Session and exit |
| Type `/` | Open the two-column local and Harness command menu; navigate with arrows and complete with `Tab` or `Enter` |
| Type `@` | Open bounded workspace file/directory mentions and insert the selected path without submitting |
| `/help` | Show local and plugin-contributed Harness commands |
| `/reasoning` | Show or hide projected reasoning blocks |
| `/transcript` | Same transcript toggle as `Ctrl+O` |
| Approval requests | Serialized keyboard modal with allow-once, reject, and cancel outcomes |
| User questions | Single-select, multi-select, and free-text protocol responses |
| Subagent tools | Claude-shaped initialization, completion, background handoff, expandable output, and a live Harness provider roster |

The transcript is rebuilt from durable Session events, not scraped from model text. User, assistant, reasoning, tool-call, tool-result, usage, request-header, and turn-outcome events are projected in log order. Untrusted terminal control bytes are rendered visibly instead of being executed.

## Architecture

```text
dsh-base bundle
  -> dsh-claude-tui/cordis.patch.yml
     -> startup argument service
     -> worker-thread code runtime
     -> one terminal-owned root Agent
        -> durable Session event projection
        -> pi-tui main-screen renderer with normal-buffer scrollback
        -> approval and user-question protocol adapters
        -> Harness subagent lifecycle projection and active-run roster
```

The plugin waits for Loader settlement before creating the Agent, scopes every event and approval to that exact Agent, delegates unknown slash commands to the Harness command registry, and reverses registrations before restoring raw terminal state. Shutdown cancels active work, drains pending input, flushes the Session, restores terminal progress and cursor state, and deliberately stays in the normal terminal buffer like the pinned Claude reference.

## Known fidelity gaps

The following are deliberately still open for the next compatibility milestones:

- Attachments and richer non-command completion affordances beyond bounded workspace file mentions.
- Exact parity with Claude's built-in command/skill catalog; this plugin exposes Harness-owned commands instead.
- Richer session rename and conversation-management flows beyond the implemented picker and exact-id resume.
- Full Claude planning, todo, and general background-job surfaces; the current implementation projects real Harness plan state and subagent lifecycle only.
- Claude's `↓ to manage` background-agent manager has no equivalent Harness capability. The TUI truthfully exposes `← for agents` and Harness-owned job controls instead of presenting a dead affordance.
- Background subagent handoff has a real Claude frame and full Harness lifecycle proof; the eventual background-completion notification is semantically verified but does not yet have a completed-state Claude golden.
- Durable “always allow” permission grants are not offered because the current Harness approval outcome contract has no equivalent. The row is visibly disabled rather than mapped to a weaker grant.
- Visual regression coverage beyond the qualified xterm-compatible true-color path, two widths, and macOS.
- Exact reproduction of proprietary model behavior, permission classification, cloud state, or undocumented internals; these are outside the plugin boundary.

Compatibility is version-pinned. Changes in later Claude Code or Harness releases require a new observation and qualification pass rather than silently claiming continued fidelity.

## Verification baseline

The current alpha has been checked with:

- Node.js `24.14.0` and pnpm `11.20.0`.
- DeepSeek Harness master commit `47f943859bef60e4160492346772ded9b24f765a`.
- TypeScript no-emit typecheck and 41 Vitest terminal-semantic tests.
- Twenty-three reference frames captured from the real Claude Code `2.1.227` PTY; 21 are active automated comparison anchors and two permission-mode frames remain reference-only.
- Real `pi-tui` ANSI rendering through an xterm-compatible headless terminal, including cell styles and hardware cursor coordinates.
- Isolated-profile install, effective-config composition, main-screen PTY boot (safe top row, Claude orange logo, truthful title, responsive dsh badge), slash/file completion, reverse search, session selection, and confirmed `Ctrl+D` terminal restoration.
- Real Harness approval rejection, structured-question answer, and foreground/background subagent runs against the official local mock server, including persisted parent/child Session event chains.

Run `corepack pnpm check` for the local qualification gate. Refresh the pinned reference fixtures with `corepack pnpm capture:claude-reference -- --cwd /path/to/a/trusted/workspace`. Dynamic scenarios use an isolated Claude config, a dummy key, and a loopback-only Anthropic mock; no external model request or user API key is involved. The capture refuses an unapproved workspace trust dialog.
