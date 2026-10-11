# Manifest-only security repacks

These are local repacks of the exact upstream npm packages, with their original
package names and versions. They are not new upstream releases. Only the
following `package.json` dependency declarations change:

| Owner | Dependency | Original | Patched |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-mcp-client@0.2.0-rc.2` | `@modelcontextprotocol/client` | `2.0.0` | `2.2.0` |
| `@deepseek-ai/libreoffice-kit@0.1.5` | `fflate` | `0.8.2` | `0.8.3` |

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

Both commands download the pinned original npm archives over HTTPS. No npm
installation, lifecycle script, or archive extraction runs. `--check` regenerates
all outputs in a temporary directory and fails if any committed output differs.
Archives use sorted member order, fixed ownership and timestamps, preserved
modes, gzip `mtime=0`, and a normalized gzip OS header. The download URLs and integrity pins are in the script;
changing them requires review of the original source and patch.

The consuming manifest and shrinkwrap must use public HTTPS artifact URLs pinned
to the exact Git commit containing these files, together with the repacked
SHA-512 integrity values. Relative `file:` tarballs and root-only overrides do
not provide the required portable consumer dependency graph.
