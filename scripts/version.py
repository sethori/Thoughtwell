#!/usr/bin/env python3
"""Release versions for Thoughtwell, computed from git tags.

Versions are MAJOR.MINOR.PATCH, each part counting 0-9 and rolling over
into the part on its left: 1.0.9 -> 1.1.0, 1.9.9 -> 2.0.0. The first release
is 1.0.1. Tags look like vX.Y.Z (vX.Y counts as vX.Y.0).

  version.py next           print the version the next release gets
  version.py latest         print the newest release tag (empty if none)
  version.py stamp X.Y.Z    write X.Y.Z into every package.json (CI only)

Source checkouts keep the placeholder 0.0.0; never commit a stamped version.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIRST = (1, 0, 1)
TAG_RE = re.compile(r"^v(\d+)\.(\d+)(?:\.(\d+))?$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def parse_tag(tag: str) -> tuple[int, int, int] | None:
    m = TAG_RE.match(tag.strip())
    if not m:
        return None
    return int(m[1]), int(m[2]), int(m[3] or 0)


def bump(v: tuple[int, int, int]) -> tuple[int, int, int]:
    # The version is a counter in base 10 per part, so out-of-range parts in an
    # old tag (v1.0.10) carry over the same way: 1.0.10 -> 1.1.0 -> next 1.1.1.
    major, minor, patch = v
    n = major * 100 + minor * 10 + patch + 1
    return n // 100, n // 10 % 10, n % 10


def latest(tags: list[str]) -> tuple[int, int, int] | None:
    versions = [v for v in (parse_tag(t) for t in tags) if v]
    return max(versions) if versions else None


def next_version(tags: list[str]) -> tuple[int, int, int]:
    top = latest(tags)
    return FIRST if top is None else bump(top)


def fmt(v: tuple[int, int, int]) -> str:
    return "%d.%d.%d" % v


def git_tags() -> list[str]:
    out = subprocess.run(["git", "tag", "--list", "v*"], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout
    return out.split()


def latest_tag_name(tags: list[str]) -> str:
    top = latest(tags)
    if top is None:
        return ""
    # Return the tag as written (it may be vX.Y rather than vX.Y.0).
    return next(t for t in tags if parse_tag(t) == top)


def package_files(root: Path = ROOT) -> list[Path]:
    files = [root / "package.json"]
    for group in ("apps", "packages"):
        files += sorted((root / group).glob("*/package.json"))
    return [f for f in files if f.exists()]


def stamp(version: str, root: Path = ROOT) -> list[Path]:
    if not VERSION_RE.match(version):
        raise ValueError(f"not a X.Y.Z version: {version!r}")
    changed = []
    for f in package_files(root):
        text = f.read_text()
        # Replace only the top-level "version" (two-space indent) to keep formatting.
        new, n = re.subn(r'(?m)^(  "version":\s*")[^"]*(")', rf"\g<1>{version}\g<2>", text, count=1)
        if n:
            json.loads(new)  # still valid JSON
            f.write_text(new)
            changed.append(f)
    return changed


def main(argv: list[str]) -> int:
    if len(argv) >= 1 and argv[0] == "next":
        print(fmt(next_version(git_tags())))
    elif len(argv) >= 1 and argv[0] == "latest":
        print(latest_tag_name(git_tags()))
    elif len(argv) == 2 and argv[0] == "stamp":
        for f in stamp(argv[1]):
            print(f"stamped {argv[1]} into {f.relative_to(ROOT)}")
    else:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
