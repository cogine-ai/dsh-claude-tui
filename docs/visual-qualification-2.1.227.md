# Claude Code 2.1.227 visual qualification

## Verdict

The implemented main-screen slice is high-fidelity against a version-pinned real Claude Code `2.1.227` PTY. The reference corpus has 24 captured frames; 22 are active automated comparison anchors. The remaining two permission-mode frames are reference-only because DeepSeek Harness does not expose equivalent Claude permission semantics. A new Harness Session uses the captured full welcome-panel geometry from row `0`; a resumed Session uses the compact header with its explicit, user-approved top safety inset. Both mappings are tested instead of being hidden inside the reference data.

This is a scoped, evidence-backed claim, not whole-product equivalence. It covers the shell, prompt and completion affordances, session picker, errors, response/tool states, approval and question panels, plan indication, and foreground/background subagent presentation. It does not claim Claude's private model behavior, permission classifier, cloud/session services, completed background-agent notification, full plan/todo system, or every terminal emulator.

## Reference identity and isolation

The reference executable reported:

```text
2.1.227 (Claude Code)
```

The original Harness-state frames were captured in the DeepSeek Harness checkout at commit `47f943859bef60e4160492346772ded9b24f765a`; the welcome-state frame was captured in this plugin checkout. Each fixture records its exact working directory and transport. Every launch disables settings sources, MCP servers, the updater, and nonessential traffic. The common Claude flags are:

```text
--settings {}
--setting-sources ""
--strict-mcp-config
--mcp-config {"mcpServers":{}}
--permission-mode manual
```

Static shell scenarios enable no tools and never submit the typed prompt. Dynamic scenarios enable only the tool under observation and run with:

- a temporary isolated `CLAUDE_CONFIG_DIR`;
- a dummy `ANTHROPIC_API_KEY` used only for the capture process;
- `ANTHROPIC_BASE_URL` bound to an ephemeral `127.0.0.1` mock;
- deterministic streamed Anthropic Messages events;
- no external Anthropic request and no user account/API credential.

The completed-tool fixture executes only a deterministic local `printf`. The approval fixture stops at the prompt, so its proposed marker command is not accepted. Session-picker data is synthetic and exists only inside the temporary capture config. The script verifies the Claude version and refuses an unapproved workspace-trust dialog.

## Captured and qualified matrix

Each JSON fixture records source identity, scenario, terminal dimensions, SHA-256 of the raw ANSI stream, active buffer, hardware cursor, visible text, and run-length encoded foreground/background/attribute data for every styled cell.

| Fixture | Status | Reference landmark |
| --- | --- | --- |
| `idle-80x24.json` | automated anchor | normal buffer; shortcuts on row 8 |
| `prompt-80x24.json` | automated anchor | typed prompt and cursor at `(25, 6)` |
| `slash-80x24.json` | automated anchor | menu on row 8; descriptions at column 30 |
| `file-mention-80x24.json` | automated anchor | `@` results directly below prompt |
| `file-mention-selected-80x24.json` | automated anchor | selected path inserted without submit |
| `history-80x24.json` | automated anchor | `Ctrl+R` search and cursor handoff |
| `ctrl-d-confirm-80x24.json` | automated anchor | first-gesture confirmation on row 8 |
| `ctrl-c-confirm-80x24.json` | automated anchor | first-gesture confirmation on row 8 |
| `idle-100x30.json` | automated anchor | same shell geometry at wider size |
| `welcome-100x30.json` | automated anchor | full welcome panel on rows 0-10; inner divider at column 46 |
| `permission-accept-edits-80x24.json` | reference only | Claude accept-edits indicator |
| `permission-plan-80x24.json` | automated anchor | durable Harness plan state projected in Claude's row/style |
| `permission-auto-80x24.json` | reference only | Claude auto-mode indicator |
| `session-picker-empty-80x24.json` | automated anchor | empty-project resume state |
| `session-picker-list-80x24.json` | automated anchor | conversation list, metadata, selection and cursor |
| `not-logged-in-error-80x24.json` | automated anchor | failed-turn rows and error color |
| `approval-80x24.json` | automated anchor | full-width command approval panel |
| `user-question-80x24.json` | automated anchor | structured single-select question panel |
| `response-streaming-80x24.json` | automated anchor | in-flight assistant row and working footer |
| `response-complete-80x24.json` | automated anchor | completed assistant row and timing footer |
| `tool-complete-80x24.json` | automated anchor | tool title, result, assistant continuation |
| `subagent-foreground-pending-80x24.json` | automated anchor | `Initializing…` and active-agent roster |
| `subagent-foreground-complete-80x24.json` | automated anchor | `Done`, expansion hint, assistant continuation |
| `subagent-background-pending-80x24.json` | automated anchor | background handoff and roster |

The fixtures live in `tests/fixtures/claude-code-2.1.227/` and are produced only by `scripts/capture-claude-reference.mjs`; the candidate renderer never generates or rewrites its own expected data.

## Measured visual anchors

The reference uses the normal terminal buffer, preserving scrollback. At `80x24`, the immutable compact/returning Claude capture and the candidate mapping are:

| Element | Claude reference | DeepSeek Harness candidate |
| --- | --- | --- |
| viewport safety inset | none | blank row `0` |
| logo and identity | rows `0-2` | rows `1-3` |
| blank separation | rows `3-4` | rows `4-5` |
| upper divider | row `5`, width `80` | row `6`, width `80` |
| prompt | row `6` | row `7` |
| lower divider | row `7`, width `80` | row `8` |
| primary context or menu | row `8` onward | row `9` onward |
| secondary mode line | row `9` in idle states | row `10` in idle states |

For `welcome-100x30.json`, Claude's panel occupies rows `0-10`, its inner divider is at column `46`, and the prompt cursor is on row `14`. The candidate new-Session panel uses the same measured rows and divider column, so it owns row `0` rather than adding the compact header's safety inset.

The candidate title is `DSH Claude TUI`; the expanded title also shows the executing TUI package version. In the compact state, its third logo row keeps the live working directory on the left and adds a right-aligned `powered by dsh` badge at widths of 48 columns or more; below that width the badge disappears rather than displacing terminal content. In the expanded state, the left cell contains the live model/effort and working directory, while the right cell shows `/help` guidance plus launcher-verified Harness version, system/bundled source, DSH tools mode, and shared/isolated Home. The final panel row retains the right-aligned `powered by dsh` badge. Session ID remains available in the compact resumed-Session header instead of crowding the new-Session Hero.

Observed true-color roles are:

| Role | Value |
| --- | --- |
| logo/brand | `#d77757` |
| logo interior background | `#000000` |
| metadata | `#999999` |
| dividers | `#888888` |
| selected slash/question item | `#b1b9f9` |
| plan state | `#48968c` |
| success/tool glyph | `#4eba65` |
| error/auth warning | `#ff6b80` |
| candidate-only dsh badge | white `#ffffff` on official blue `#4d6bfe` |

The implementation uses these measured true-color values directly rather than mapping them to the 16-color ANSI palette.

## Comparison method

The candidate is rendered through a real `pi-tui` ANSI path into the same xterm headless cell model used to normalize Claude's PTY stream. Automated assertions compare the relevant observable contract for each state:

- active buffer and scrollback-visible layout;
- compact-header logo count and safety inset, expanded-panel border/divider geometry, prompt row, modal rows and roster placement;
- stable glyphs and labels, including Claude's non-breaking space after `❯`;
- hardware cursor coordinates and modal/editor cursor ownership;
- selected foreground, background, bold, dim, and inverse runs;
- response, tool, error, approval, question, session-picker and subagent row order;
- state transitions such as file insertion without submit, approval outcome, question answer, transcript expansion, roster hide/show, subagent cleanup, and two-gesture exit.

This is a terminal cell-grid comparison, not a raster screenshot diff. For a TUI, buffer choice, glyphs, cell coordinates, SGR styles, and hardware cursor are the application-controlled visual output. Font rasterization, antialiasing, window chrome, and line height belong to the terminal emulator.

Dynamic host semantics are normalized rather than falsely copied. The plugin displays the live Harness provider/model, session id, working directory, command registry, subagent provider, and Agent state. Claude's product identity, billing/login state, model label, private command catalog, and `general-purpose` subagent label are not substituted for real Harness values.

## Intentional semantic boundaries

Five visible differences are deliberate and tested:

1. Harness currently grants `allowed-once`, rejection, or cancellation; it has no durable Claude “always allow” outcome. The second approval row therefore says it is unavailable and cannot be selected.
2. Claude's background panel advertises `↓ to manage`. Harness has no equivalent manager contract, so the row keeps Claude's captured geometry and style but exposes the real `← for agents` roster control instead.
3. Claude reports private subagent tool-use/token/time metrics. Harness does not provide all of those values on this surface, so completion says `Done` without inventing metrics. Expanded mode shows the real child result.
4. The compact returning state reserves a blank top row before Claude's logo to address clipping at the terminal viewport boundary. The expanded new-Session panel follows the captured bordered geometry from row `0`, so it does not add that inset.
5. Product identity is truthful: the orange Claude-shaped logo remains, while the title reads `DSH Claude TUI` and the expanded form includes the real package version. Both header forms retain the official-blue `powered by dsh` badge. The expanded panel replaces Claude's account, billing and release-note cells with live DSH model/effort/cwd data, `/help` guidance, and launcher-verified Harness/Home/tools-mode provenance. DSH `native`, `code`, and `both` map to `Standard`, `PTC`, and `Both (Native + PTC)`; Minimal is not presented as a tools mode.

These boundaries lower literal text identity in narrowly defined cells while preserving both visual shape and truthful interaction semantics.

## Real Harness semantic qualification

Visual projection tests are not the only evidence. An isolated `claude-tui` Harness profile was run against Harness's official local LLM mock server, using a dummy local bearer token and no external API. The source checkout remained read-only.

| Gate | Runtime evidence |
| --- | --- |
| startup | the plugin completed Loader composition and entered the live TUI; this verified the ancestor-tree settlement fix rather than only a unit helper |
| header identity | the compact/resumed path was qualified in an `80x24` real Harness PTY: it emitted the blank safety row, Claude's orange three-row logo, `DSH Claude TUI`, the live DeepSeek model/session/cwd, and a white-on-`#4d6bfe` `powered by dsh` badge; the expanded new-Session path is cell-qualified against `welcome-100x30.json` and packed-launcher tests additionally verify its TUI/Harness versions, runtime source, PTC label, `/help` tip, and DSH badge |
| approval rejection | a danger-full-access Bash call proposed `touch /tmp/dsh-claude-tui-should-not-exist`; selecting `No` persisted `approval/asked`, rejected `approval/decided`, an error tool result, and a completed turn; the marker remained absent |
| structured question | `ask_user_question` displayed the captured panel, returned `Alpha`, persisted the structured answer in the tool result, and completed the turn |
| foreground subagent | the live TUI showed `Initializing…`, `⏺ main`, the real `spawn` provider, then `Done`; the parent persisted a successful `subagent` call/result while the child Session independently persisted its delegated prompt, response, and completed turn |
| background subagent | the tool result persisted `started subagent <id>`; the active roster appeared, the child ran in its own Session, `subagent-settled` returned the closing message to the parent, the roster disappeared, and the parent completed the initial and settlement-notice turns |

The foreground persisted event chain was:

```text
parent: tool/call subagent -> tool/result isError=false -> assistant/message -> turn/end completed
child:  user/message       -> assistant/message          -> turn/end completed
```

The background chain added an actual parent notice:

```text
tool/result "started subagent <id>"
child turn/end completed
user/message source.kind="subagent-settled"
parent follow-up turn/end completed
```

## Red-to-green evidence

The reference comparisons and live gates exposed and fixed concrete mismatches rather than merely blessing the first rendering:

| Area | Before | Qualified result |
| --- | --- | --- |
| terminal buffer | alternate screen | normal/main screen with scrollback |
| shell rows | dividers at `19/21` | Claude reference at `5/7`; candidate at `6/8` after the explicit safety inset |
| new-Session welcome | compact unauthenticated fixture was the only startup baseline | independently captured full panel; matching border rows/divider with truthful DSH content |
| identity | no Claude-shaped logo | three measured orange logo rows, truthful title, responsive dsh badge |
| palette | ANSI approximation | pinned RGB roles above |
| prompt | padded generic editor line | captured glyph, NBSP and cursor geometry |
| `Ctrl+R` | no search row; prompt kept cursor | Claude row-8 search behavior mapped to candidate row 9 with cursor handoff |
| slash/file completion | no matching affordance | captured row, selection and insertion behavior |
| first exit gesture | immediate exit | measured two-gesture confirmation window |
| startup | plugin could await its own Loader ancestry | waits only for its ancestor composition tree |
| tool streaming | block-end chunks could create a ghost `Working` assistant row | non-visible chunks do not create assistant transcript items |
| approval/question | presentation-only prototypes | real Harness protocol providers and persisted outcomes |
| subagent | generic tool JSON | captured Agent rows plus real Harness lifecycle roster |

Exit timing was measured separately because a still frame cannot establish it. The implementation pins the observed `800ms` window and tests `799ms` as accepted versus `801ms` as expired. A non-empty draft followed by `Ctrl+D` remains unchanged, matching the reference.

## Reproduce

Use Node.js `24.14.0` and pnpm `11.20.0`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm capture:claude-reference -- --cwd /path/to/a/trusted/workspace
corepack pnpm vitest run tests/app.spec.ts tests/session-picker.spec.ts
corepack pnpm check
```

The capture command requires the local `claude` executable at exactly `2.1.227`, but it does not require a working Claude API key for these scenarios. Refreshing fixtures is a version-pinned qualification action: a different Claude Code version must use a new fixture directory and report instead of overwriting this baseline.
