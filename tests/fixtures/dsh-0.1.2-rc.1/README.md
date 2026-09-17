# DSH 0.1.2-rc.1 migration fixture

Synthetic conversation generated with the published 0.1.2-rc.1 SessionStore, LLM message constructors, and JsonlSessionPersistence (`compression: none`). No model request, user data, or credentials. The native writer produced these bytes, including the historical stream representation. The packed-TUI migration test must preserve this source and create a V3 successor.

The fixture uses the writer's native version-0 header, text/usage chunk events, and their `sourceEventSeqs` settlement. Its usage totals agree with the streamed usage, as required by V3 migration validation. The test restores it through the installed TUI in an isolated Home, verifies the migrated reply, checks the version-3 successor, and compares the original bytes.
