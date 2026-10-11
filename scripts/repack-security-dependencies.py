#!/usr/bin/env python3
"""Reproduce the two pinned, manifest-only production dependency repacks."""

import argparse
import base64
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "vendor" / "security"
MANIFEST = "package/package.json"
PACKAGES = (
    {
        "name": "@deepseek-ai/dsh-mcp-client",
        "version": "0.2.0-rc.2",
        "filename": "dsh-mcp-client-0.2.0-rc.2.tgz",
        "url": "https://registry.npmjs.org/@deepseek-ai/dsh-mcp-client/-/dsh-mcp-client-0.2.0-rc.2.tgz",
        "integrity": "sha512-UqP2sY1r6qAhBPFeuclqrXiMBBxPaCNrXlXRqKxAON7uI1wmZZ0B3/1GmBviQ3/WjjTQlOOkj0su2v4e5DMkug==",
        "dependency": "@modelcontextprotocol/client",
        "before": "2.0.0",
        "after": "2.2.0",
    },
    {
        "name": "@deepseek-ai/libreoffice-kit",
        "version": "0.1.5",
        "filename": "libreoffice-kit-0.1.5.tgz",
        "url": "https://registry.npmjs.org/@deepseek-ai/libreoffice-kit/-/libreoffice-kit-0.1.5.tgz",
        "integrity": "sha512-H12xtUsAyl70zFeQ5pk5GGRc3N1+6zn+DVAcqwlguI6EvqopBGP3xkUmePU7g5f6ydYlDZLWedHT9lTSL7zLxA==",
        "dependency": "fflate",
        "before": "0.8.2",
        "after": "0.8.3",
    },
)

README = """# Manifest-only security repacks

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
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def sri(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def download(spec):
    request = urllib.request.Request(
        spec["url"], headers={"User-Agent": "dsh-claude-tui-security-repack/1"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        if not response.geturl().startswith("https://"):
            raise ValueError("original archive redirected outside HTTPS")
        data = response.read()
    if sri(data) != spec["integrity"]:
        raise ValueError("original archive SHA-512 mismatch: " + spec["name"])
    return data


def read_archive(data):
    members = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or not path.parts
                or path.parts[0] != "package"
                or member.name in members
            ):
                raise ValueError("unexpected or duplicate archive path: " + member.name)
            if not (
                member.isfile() or member.isdir() or member.issym() or member.islnk()
            ):
                raise ValueError("unsupported archive member type: " + member.name)
            contents = None
            if member.isfile():
                contents = archive.extractfile(member).read()
            members[member.name] = (member, contents)
    if MANIFEST not in members or not members[MANIFEST][0].isfile():
        raise ValueError("missing regular package/package.json")
    return members


def member_inventory(members):
    inventory = []
    for name in sorted(members):
        if name == MANIFEST:
            continue
        member, contents = members[name]
        entry = {"path": name, "type": member.type.decode("ascii"), "mode": oct(member.mode)}
        if contents is not None:
            entry.update({"bytes": len(contents), "sha256": sha256(contents)})
        elif member.issym() or member.islnk():
            entry["link_target"] = member.linkname
        inventory.append(entry)
    return inventory


def write_archive(members, manifest):
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(members):
            original, contents = members[name]
            member = copy.copy(original)
            member.uid = member.gid = 0
            member.uname = member.gname = ""
            member.mtime = 0
            member.pax_headers = {}
            if name == MANIFEST:
                contents = manifest
            if contents is not None:
                member.size = len(contents)
                archive.addfile(member, io.BytesIO(contents))
            else:
                archive.addfile(member)
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=compressed, mode="wb", compresslevel=9, mtime=0) as output:
        output.write(tar_buffer.getvalue())
    packed = compressed.getvalue()
    # Gzip's OS byte is informational; force "unknown" across Python/platforms.
    return packed[:9] + b"\xff" + packed[10:]


def repack(spec):
    original = download(spec)
    source = read_archive(original)
    original_manifest = json.loads(source[MANIFEST][1])
    if (original_manifest.get("name"), original_manifest.get("version")) != (
        spec["name"], spec["version"]
    ):
        raise ValueError("unexpected original package identity: " + spec["name"])
    patched_manifest = copy.deepcopy(original_manifest)
    if patched_manifest.get("dependencies", {}).get(spec["dependency"]) != spec["before"]:
        raise ValueError("unexpected original dependency declaration: " + spec["name"])
    patched_manifest["dependencies"][spec["dependency"]] = spec["after"]
    packed = write_archive(source, json_bytes(patched_manifest))
    target = read_archive(packed)
    if set(source) != set(target):
        raise ValueError("archive member set changed: " + spec["name"])
    if json.loads(target[MANIFEST][1]) != patched_manifest:
        raise ValueError("repacked manifest has unintended semantic changes")
    for name in source:
        before, before_bytes = source[name]
        after, after_bytes = target[name]
        if (before.type, before.mode, before.linkname) != (after.type, after.mode, after.linkname):
            raise ValueError("archive member type, mode, or link changed: " + name)
        if name != MANIFEST and before_bytes != after_bytes:
            raise ValueError("non-manifest member bytes changed: " + name)
    original_inventory = member_inventory(source)
    repacked_inventory = member_inventory(target)
    if original_inventory != repacked_inventory:
        raise ValueError("preserved source inventory mismatch")
    source_inventory_sha256 = sha256(json_bytes(original_inventory))
    verification = {
        "same_package_name_and_version": True,
        "manifest_only_semantic_change": True,
        "all_non_manifest_member_bytes_links_types_and_modes_unchanged": True,
        "original_member_count": len(source),
        "non_manifest_member_count": len(original_inventory),
        "original_non_manifest_inventory_sha256": source_inventory_sha256,
        "repacked_non_manifest_inventory_sha256": sha256(json_bytes(repacked_inventory)),
        "preserved_license_paths": [
            name for name in sorted(source)
            if "license" in name.lower() or "copying" in name.lower()
        ],
        "non_manifest_inventory": original_inventory,
    }
    if "package/LICENSE" not in verification["preserved_license_paths"]:
        raise ValueError("expected upstream LICENSE is missing")
    provenance = {
        "package": spec["name"],
        "version": spec["version"],
        "artifact": spec["filename"],
        "dependency_patch": {
            spec["dependency"]: {"from": spec["before"], "to": spec["after"]}
        },
        "original": {
            "url": spec["url"], "integrity": spec["integrity"],
            "sha256": sha256(original), "bytes": len(original),
        },
        "repacked": {
            "integrity": sri(packed), "sha256": sha256(packed), "bytes": len(packed),
        },
        "manifest": {
            "original_sha256": sha256(source[MANIFEST][1]),
            "repacked_sha256": sha256(target[MANIFEST][1]),
        },
        "verification": verification,
    }
    return packed, provenance


def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    provenance = {
        "schema_version": 1,
        "generator": "scripts/repack-security-dependencies.py",
        "archive_format": "sorted PAX tar; uid/gid/mtime=0; empty ownership names; gzip mtime=0, OS=255",
        "packages": [],
    }
    for spec in PACKAGES:
        packed, record = repack(spec)
        (destination / spec["filename"]).write_bytes(packed)
        provenance["packages"].append(record)
        print("Verified manifest-only repack: " + spec["name"] + "@" + spec["version"], flush=True)
    (destination / "provenance.json").write_bytes(json_bytes(provenance))
    (destination / "README.md").write_bytes(README.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="regenerate in temp and compare committed outputs")
    args = parser.parse_args()
    try:
        if args.check:
            with tempfile.TemporaryDirectory(prefix="dsh-security-repack-check-") as temporary:
                generated = Path(temporary)
                generate(generated)
                mismatches = [
                    path.name for path in sorted(generated.iterdir())
                    if not (DESTINATION / path.name).is_file()
                    or path.read_bytes() != (DESTINATION / path.name).read_bytes()
                ]
                if mismatches:
                    print("Repack check failed: " + ", ".join(mismatches), file=sys.stderr)
                    return 1
            print("All committed security repack outputs match regenerated bytes.")
        else:
            generate(DESTINATION)
        return 0
    except (OSError, ValueError, tarfile.TarError, KeyError) as error:
        print("Security repack failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
