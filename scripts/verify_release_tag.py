"""Reject release tags that do not correspond to the firmware version."""

from __future__ import annotations

import argparse
import re

try:
    from scripts.package_update import firmware_version
except ModuleNotFoundError:  # Direct invocation: python scripts/verify_release_tag.py
    from package_update import firmware_version  # type: ignore[no-redef]


TAG_PATTERN = re.compile(r"^v(?P<version>\d+\.\d+\.\d+)(?:-rc\.(?P<rc>[1-9]\d*))?$")


def verify_release_tag(tag: str, version: str | None = None) -> bool:
    match = TAG_PATTERN.fullmatch(tag)
    if not match:
        raise ValueError("tag must be vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N")
    expected = version or firmware_version()
    if match.group("version") != expected:
        raise ValueError(f"tag {tag} does not match firmware version {expected}")
    return match.group("rc") is not None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag")
    args = parser.parse_args()
    prerelease = verify_release_tag(args.tag)
    print("prerelease" if prerelease else "stable")


if __name__ == "__main__":
    main()
