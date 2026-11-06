# Manifest-only security repacks

These are local repacks of the exact upstream npm packages, with their original
package names and versions. They are not new upstream releases. Only the
following `package.json` dependency declarations change:

| Owner | Dependency | Original | Patched |
| --- | --- | --- | --- |
| `@deepseek-ai/libreoffice-kit@0.1.5` | `fflate` | `0.8.2` | `0.8.3` |
| `@deepseek-ai/dsh-action-cards@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-agent@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-agent-loop@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-agent-preset-registry@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-account-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-job-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-remote-access@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-session-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-settings-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-terminal-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-workspace-controller@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-api-workspace-files@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-chunked-list@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-client-connection@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-client-file-upload@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-client-product-analytics@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-client-ui-plugin-manager@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-client-ui-trajectory@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-command-feedback@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-commands@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-cordis-host-runner@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-creation-recommendations@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-deepseek-account-platform@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-experimental-agent-team@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-experimental-api-speech-to-text@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-experimental-liveshare@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-goal@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-harness-dev-context@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-host-plugin-inventory@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-http-proxy@0.2.2-rc.1` | `undici` | `8.11.2` | `8.12.2` |
| `@deepseek-ai/dsh-llm@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-llm-retry@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-mcp-client@0.2.2-rc.1` | `@modelcontextprotocol/client` | `2.2.0` | `2.3.0` |
| `@deepseek-ai/dsh-message-feedback@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-office-to-pdf@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-permission-presets@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-plan-mode@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-plugin-manager@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-plugin-recommendations@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-sandbox-policy@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-schedule@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-projection@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-projection-cache@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-reference@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-stats@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-title@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-session-turn-outline@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-storage-domain@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-subagent@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-time-context@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-tmux-context@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-token-meter@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-tool-subagent@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-tool-todo@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-typert-registry@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-user-approval@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-user-questions@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |
| `@deepseek-ai/dsh-web-fetch-http@0.2.2-rc.1` | `undici` | `8.11.2` | `8.12.2` |
| `@deepseek-ai/dsh-workspace@0.2.2-rc.1` | `zod` | `4.4.3` | `4.6.6` |

Every other archive member retains its contents, link target, type, and mode,
including all upstream sources and `package/LICENSE`. The generator verifies
the original archives against pinned npm SHA-512 integrity values before
patching. `provenance.json` records original URLs and hashes, repack hashes,
manifest verification, and the complete preserved non-manifest inventory.
These checks establish reproducibility and content integrity; they are not a
signed upstream provenance attestation.

From the repository root, regenerate with Python 3 and the standard library:

```sh
python3 scripts/repack-security-dependencies.py
python3 scripts/repack-security-dependencies.py --check
```

Both commands download the pinned original npm archive over HTTPS. No npm
installation, lifecycle script, or archive extraction runs. `--check` regenerates
all outputs in a temporary directory and fails if any committed output differs.
Archives use sorted member order, fixed ownership and timestamps, preserved
modes, gzip `mtime=0`, and a normalized gzip OS header. The download URLs and integrity pins are in `scripts/security-repacks.json`;
changing them requires review of the original source and patch.

The workspace uses these verified local archives through pnpm overrides.
The npm artifact embeds all 599 required package nodes, including 324 DSH
packages and 15 conflicting nested versions, with standard `bundleDependencies`.
All archives are SHA-512 verified. This prevents external parents from loading
original vulnerable owners through npm hoisting. The 78 platform optionals
remain exact-pinned and selected by npm.

The dependency audit record is `vendor/security/runtime-lock.json`. No root npm
shrinkwrap is published: registry inflation of the previous partial bundle
incorrectly treated missing transitive dependencies as bundled. Installed-artifact
qualification now exercises actual registry metadata through a loopback server.
The existing manifest-only repairs and their provenance remain unchanged.
The Office archive retains its previously published commit-pinned source URL in
the audit record. Its bundled dependency declaration uses the exact recorded
version so npm can validate the installed node.
Root-only overrides and source-relative archive paths are not the consumer fix.
