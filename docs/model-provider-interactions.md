# Model and Provider Interactions

This document fixes the ownership boundary for the model picker and API-key setup surfaces. The TUI borrows Claude Code interaction patterns, but DeepSeek Harness remains authoritative for every runtime capability and persisted value.

## Source-of-truth matrix

| Concern | Authority | TUI behavior |
| --- | --- | --- |
| Open command and shortcut | Claude Code interaction reference | `/model` and `Option+P` on macOS / `Alt+P` elsewhere open a bottom terminal overlay without changing the prompt draft. |
| List navigation | Claude Code interaction reference | Up/down select a row, left/right select an advertised effort, Enter applies to this Agent, `d` also saves the DSH default, and Esc cancels. |
| Providers and models | DSH | Read `llm.listProviders()` and `llm.listModels(provider)` every time the picker opens. Never add a provider or model that DSH did not return. |
| Exact model capabilities | DSH | Read `llm.resolveModelInfo(provider, model)`. Only returned reasoning efforts are selectable. |
| Advisory catalog boundary | DSH | Keep the current or default route visible as `not advertised`; absence from `listModels()` is not treated as invalid. |
| Current-Agent selection | DSH Agent seam | Mutate the Agent's `ModelSelectionRef.current`. The in-flight `assembled` selection is never rewritten, so a switch applies to the next DSH model request. |
| Default model | DSH | Read `agentDefaultModel.currentSelection()` and persist only through `saveSelection()`. The UI does not maintain another default. |
| Catalog changes | DSH | Refresh an open picker on `llm/adapters-updated`; a later open always performs a fresh read. |
| Provider configuration | DSH | Merge active routes with `llm.listConfigurableProviders()` and follow its `settingsNs` / `settingsPath`. Do not infer configuration from provider names. |
| Credential reference | DSH settings | Read `apiKeyEnv` from the resolved provider profile. A provider without that field is described as provider-managed authentication, not given a fabricated API-key field. |
| Configured/source/writable state | DSH credentials | Render only `credentials.describe(ref)`. Environment-shadowed keys remain read-only; writable keys are stored only through `credentials.set(ref, value)`. |
| Secret presentation | TUI security boundary | Render bullets only. The raw value is never rendered, copied into a Session event, included in UI error output, or persisted in TUI-owned durable state; an explicit save passes it only to DSH credentials. Provider-supplied save-error details are hidden because they may echo all or part of the key. |

When the two products differ, the DSH state wins and the TUI names the difference. Claude Code is an interaction reference, not a promise of Anthropic model, account, cache, permission-classifier, or cloud semantics.

## Model flow

```text
closed
  -> loading live DSH registry
  -> ready | load failure
  -> choose route and optional advertised effort
  -> prior assistant output and route changed?
       yes -> explicit history/cache warning -> confirm | cancel
       no  -> continue
  -> update current Agent selection
  -> if d: ask DSH to save the same selection as its default
```

Selecting a new route while an Agent is running is allowed. DSH snapshots `ModelSelectionRef.current` into `assembled` during prompt assembly; therefore the current HTTP/model operation is unchanged and the new selection starts with the next request. The footer and confirmation copy say “next request” rather than claiming an immediate swap.

An effort left untouched on an ordinary different model remains absent in the selection, preserving that adapter's default. If the row is the DSH-saved default route, its saved effort is preserved instead. Once the user presses left or right, the exact returned effort id is stored. No aliases, clamping across models, or invented `low`/`medium`/`high` ladder is allowed.

## Provider and credential flow

`/provider` lists active DSH routes and one of these states:

| DSH state | Surface |
| --- | --- |
| Credential configured and writable | `configured · <source>`; Enter opens a masked replacement field. |
| Credential missing and writable | `not configured`; Enter opens a required masked field. |
| Credential configured but read-only | `configured · <source> · read-only`; Enter explains that the source is managed outside the TUI. |
| No DSH credential reference | `authentication managed by provider`; no key editor is shown. |
| Settings or credential metadata unavailable | `configuration unavailable`; the error is shown without guessing a fallback. |

At startup, automatic credential onboarding is intentionally narrow: it opens only when no active route is known usable and exactly one missing credential is writable. A successful save happens before an invocation-supplied initial prompt is submitted. Cancelling keeps that prompt as an editable draft. This avoids silently sending a real request that DSH already says cannot authenticate.

API-key input accepts printable non-space ASCII after trimming, rejects quoted values, and mirrors the DSH Web heuristic for uppercase environment-assignment pastes: `NAME=value` is rejected when the first character after `=` is not another `=`, while `KEY=` and `KEY==` remain valid opaque-key shapes. This is format validation, not a connectivity test; the next real model request remains the authoritative provider check.

## Non-goals

- Hardcoding the current two DeepSeek models, dormant pi-ai/OpenAI routes, or an effort taxonomy.
- Treating the advertised catalog as a routing whitelist.
- Reading or displaying a resolved credential value.
- Storing secrets in plugin settings, process logs, terminal scrollback, or Session history.
- Claiming Claude Code's account, billing, cache, or model-switch semantics where DSH exposes different behavior.
