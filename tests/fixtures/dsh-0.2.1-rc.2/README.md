# DSH 0.2.1-rc.2 predecessor fixture

Generated from the published Session, LLM, and JSONL backend at `0.2.1-rc.2`
in an isolated npm installation. No provider request, credential, or user data
was used. The released BlockAssembler and AssistantStreamAccumulator produced
both assistant messages from identical chunks; the released JSONL backend
wrote the physical file with `compression: none`, through create, append, flush,
and close. No normalization or manual JSONL rewriting was applied.

The Session `rc21-tui-session` has 11 events: a complete two-step turn, a
`run_code` tool call, first-class tool-role result, and final reply. It omits cwd.
The installed-artifact test resumes it with DSH `0.2.2-rc.1`, checks the prompt,
reply and tool result, and requires the original bytes to remain a prefix.

File SHA-256: `e05003982565c649f942619eddaeb1da76c54c7578db326e7664c85024259693` (3356 bytes).

Generation package `lib/index.js` SHA-256 values:

- `@deepseek-ai/dsh-session`: `2f5dd07cb5c744a29abbb8003a8a4cefd9e582c6e2538074ca299a0ddd02a3bf`
- `@deepseek-ai/dsh-llm`: `d18d8ae4c8d961e628708c1e4698e09716a0ebb80e55a672e0bde1029bec1155`
- `@deepseek-ai/dsh-session-persistence-jsonl`: `973dd78679b2661d6f492343bc22b124ae958aa597d3b36c698a2c650f909984`
