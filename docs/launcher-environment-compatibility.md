# Launcher environment compatibility

`dsh-claude-tui` is both a Harness bundle and a one-command launcher. The
launcher must make an existing DSH environment useful when it is safe, while
remaining able to start from a clean machine without adopting or overwriting
unowned state.

## Default decision order

With `DSH_CLAUDE_TUI_RUNTIME=auto` (the default), the launcher completes the
whole decision before changing the selected user DSH home:

1. Inspect the requested/default DSH home and choose a launcher-owned profile.
2. Look for `@deepseek-ai/dsh` associated with that home under
   `profiles/node_modules`, then for a verifiable `dsh` executable on `PATH`.
3. Accept only package manifests named `@deepseek-ai/dsh` whose version is in
   `>=0.1.0-rc.6 <0.1.1` and whose declared bin exists inside the package.
4. Run each otherwise eligible external candidate through the current packed
   TUI's compatibility probe.
5. Use the first candidate that passes; otherwise use the launcher-pinned
   `@deepseek-ai/dsh@0.1.0-rc.6`.
6. Create or reconcile only the selected launcher-owned profile, then replace
   the launcher process with the selected Harness process.

The launcher does not scan arbitrary npm/pnpm caches, invoke a nested
`npx @deepseek-ai/dsh@latest`, or retry another runtime after a real Harness
launch has begun. The last rule prevents duplicate model requests and Session
writes.

## Welcome runtime provenance

After resolving the complete launch plan, the launcher replaces any inherited
internal snapshot with a bounded record of the selected Harness version,
`system`/`bundled` runtime kind, `shared`/`isolated` home kind, exact DSH home,
and effective `DSH_TOOLS_MODE`. The startup plugin validates this record before
the expanded welcome panel renders it; malformed or missing data is ignored
instead of crashing the TUI. The snapshot is process-local and is never written
to a Session, profile, credential store, prompt, or model request.

The product labels stay mapped to DSH's real tools configuration:

- `native` renders as `Standard`;
- `code` renders as `PTC`;
- `both` renders as `Both (Native + PTC)`.

`Minimal` remains an Agent-composition choice, not a fourth DSH tools mode. A
direct `dsh --profile ...` launch has no launcher decision to report, so the
panel says that provenance is unavailable rather than guessing it.

## DSH home and profile ownership

An unset or empty `DSH_HOME` selects `~/.dsh`. A non-empty `DSH_HOME` is an
explicit user choice and is authoritative.

The current profile name is `dsh-claude-tui`. The previous launcher-managed
name, `claude-tui`, remains supported:

| State | Result |
| --- | --- |
| Valid launcher-managed `claude-tui` | Reconcile and reuse it in place. |
| Unowned `claude-tui` with no launcher marker | Leave it untouched and use `dsh-claude-tui`. |
| Missing `dsh-claude-tui` | Create it atomically. |
| Valid launcher-managed `dsh-claude-tui` | Reconcile only launcher-owned registration and marker fields. |
| Corrupt/unsupported launcher marker or an unowned `dsh-claude-tui` | Treat the home as unsafe. |

If the implicit `~/.dsh` is unsafe, automatic mode uses the bundled runtime
with `~/.dsh-claude-tui` and renders a visible notice. Credentials and Sessions
are not copied, so they remain in the original home. If an explicit
`DSH_HOME` is unsafe, startup fails with the exact conflict instead of silently
switching homes. The isolated home is checked once; there is no recursive
fallback to more directories.

Sessions, credentials, settings, and the shared profile-module fallback are
DSH-home scoped rather than profile scoped. A shared-home launch sees existing
DSH state. An isolated-home launch intentionally does not.

## Compatibility probe

The external-runtime probe uses a fresh temporary DSH home, OS home, and
working directory. It creates and disposes a temporary Agent and Session,
flushes that Session, and requires a token-bound machine-readable result from
the exact TUI package being launched. It does not send a model request.

The child receives a small platform/locale allowlist plus temporary paths,
`DSH_TELEMETRY_DISABLED=1`, and the probe token. Provider credentials, API
keys, proxy variables, `NODE_OPTIONS`, user `.env` files, user patches, and
bootstrap-hook variables are not inherited. Runtime and output are bounded;
timeout, excessive output, missing services, module identity errors, and an
unexpected result all reject that external candidate.

Temporary probe state is deleted after the child exits. A rejected external
candidate cannot modify the requested user DSH home.

## Deterministic override

`DSH_CLAUDE_TUI_RUNTIME` accepts:

- `auto` — qualified external DSH first, then pinned bundled DSH;
- `system` — require a qualified external DSH and fail if none passes;
- `bundled` — bypass external discovery and use the pinned bundled DSH.

Examples:

```sh
DSH_CLAUDE_TUI_RUNTIME=bundled npx dsh-claude-tui
DSH_CLAUDE_TUI_RUNTIME=system npx dsh-claude-tui
DSH_HOME=~/.dsh-team npx dsh-claude-tui
```

## Remaining boundary

The probe qualifies one launch composition; it cannot make concurrent Harness
processes with different dependency trees safe against the same DSH home.
Harness maintains a home-level module fallback that either process may
reconcile. Use sequential launches, or give concurrent runtimes separate
`DSH_HOME` values.

Compatibility is intentionally limited to the DSH `0.1.0` series above. A
future DSH package may satisfy a wider-looking semantic range yet change an
injected service contract; the runtime probe is therefore required in addition
to the manifest version check.
