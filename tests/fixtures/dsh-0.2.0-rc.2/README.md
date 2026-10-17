# DSH 0.2.0-rc.2 Session fixture

Generated with the previously installed, published `@deepseek-ai/dsh-session@0.2.0-rc.2`, `@deepseek-ai/dsh-llm@0.2.0-rc.2`, and `@deepseek-ai/dsh-session-persistence-jsonl@0.2.0-rc.2`. This fixture covers direct resume from the previous supported writer, whose Session format was already V4; V0/V3 migration tests and newly generated V4 sessions do not cover that writer.

The old JSONL backend used an isolated temporary root, `compression: 'none'`, `create`, and its write handle's `append`, `flush`, and `close`. The committed `session.v4.jsonl` is the writer's unchanged physical output, including timestamps, generated message IDs, header, and final newline. Its SHA-256 is `4470a39d833559d2640f951c5cbe3af85c6454d44f0cfbb478bc5a9b9dbb0e6f` (3,329 bytes). No normalization or manual JSONL rewriting was applied.

The synthetic session `v4-tui-session` contains one complete two-step turn and 11 events. Its prompt is `A prompt from DSH 0.2.0-rc.2`, the `run_code` call ID is `v4-call`, its first-class tool-role result is `V4 tool result`, and its final reply is `A restored V4 reply.` Both assistant messages were produced by the released `BlockAssembler` from the same chunks recorded by the released `AssistantStreamAccumulator`, including usage and finish chunks. No model request, credentials, or user Session data were used. The header omits `cwd`, so the backend stores it below `_no-cwd/v4-tui-session/`.

Read-opening this output with the old `0.2.0-rc.2` backend retained all 11 events and unchanged bytes. Separately, read-opening and write-opening an isolated copy through the actual `0.2.1-rc.2` backend, then flushing and closing without new events, retained all 11 events, the V4 tool result, and unchanged bytes. A complete TUI resume may append new settings or working-directory events to this current-generation file; its original byte prefix must remain intact.

The old installed modules were loaded directly from their existing package directories, with each manifest version checked before generation. Their `lib/index.js` SHA-256 values were:

- `@deepseek-ai/dsh-session-persistence-jsonl`: `0845707017acc2b4a8a75eab2244fa3fd88587b8094ab32014321dce7ca1e31b`
- `@deepseek-ai/dsh-session`: `87ea85e2fb5318bf1f826db9a1c88c1b26d3ea328027a7f32b211880c4d62b9d`
- `@deepseek-ai/dsh-llm`: `9132c8a8053ee82b9fb1ded4f98c85cf557f288a15a85c552c6b1fb319ead120`
