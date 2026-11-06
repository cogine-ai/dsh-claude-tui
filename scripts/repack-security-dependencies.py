#!/usr/bin/env python3
"""Reproduce pinned, manifest-only dependency repacks without changing source code."""

import argparse
import base64
import copy
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile
import tempfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "vendor" / "security"
MANIFEST = "package/package.json"
NPM_CACHE = None
PACKAGES = json.loads((ROOT / "scripts" / "security-repacks.json").read_text())

README = """# Manifest-only security repacks

These are local repacks of the exact upstream npm packages, with their original
package names and versions. They are not new upstream releases. Only the
following `package.json` dependency declarations change:

| Owner | Dependency | Original | Patched |
| --- | --- | --- | --- |
{patch_table}

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
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def sri(data):
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def download(spec):
    data = None
    if NPM_CACHE is not None:
        digest = base64.b64decode(spec["integrity"].removeprefix("sha512-")).hex()
        cached = NPM_CACHE / "_cacache" / "content-v2" / "sha512" / digest[:2] / digest[2:4] / digest[4:]
        if cached.is_file():
            data = cached.read_bytes()
    if data is None:
        request = urllib.request.Request(
            spec["url"], headers={"User-Agent": "dsh-claude-tui-security-repack/1"}
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    if not response.geturl().startswith("https://"):
                        raise ValueError("original archive redirected outside HTTPS")
                    data = response.read()
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
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
    with ThreadPoolExecutor(max_workers=6) as pool:
        for spec, (packed, record) in zip(PACKAGES, pool.map(repack, PACKAGES)):
            (destination / spec["filename"]).write_bytes(packed)
            provenance["packages"].append(record)
            print("Verified manifest-only repack: " + spec["name"] + "@" + spec["version"], flush=True)
    (destination / "provenance.json").write_bytes(json_bytes(provenance))
    table = "\n".join(
        f"| `{spec['name']}@{spec['version']}` | `{spec['dependency']}` | `{spec['before']}` | `{spec['after']}` |"
        for spec in PACKAGES
    )
    (destination / "README.md").write_bytes(README.replace("{patch_table}", table).encode("utf-8"))


def main():
    global NPM_CACHE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="regenerate in temp and compare committed outputs")
    parser.add_argument("--npm-cache", type=Path, help="reuse original tarballs from an npm cache; integrity is always verified")
    args = parser.parse_args()
    NPM_CACHE = args.npm_cache
    try:
        if args.check:
            with tempfile.TemporaryDirectory(prefix="dsh-security-repack-check-") as temporary:
                generated = Path(temporary)
                generate(generated)
                expected_names = {path.name for path in generated.iterdir()}
                actual_names = {path.name for path in DESTINATION.iterdir()} if DESTINATION.is_dir() else set()
                mismatches = [
                    path.name for path in sorted(generated.iterdir())
                    if not (DESTINATION / path.name).is_file()
                    or path.read_bytes() != (DESTINATION / path.name).read_bytes()
                ]
                mismatches.extend(sorted(actual_names - expected_names))
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
