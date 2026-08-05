"""Build the checksummed, reproducible NoteFall 88 manufacturing bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.package_update import firmware_version, write_reproducible  # noqa: E402
PACKAGE_FILES = (
    "LICENSE",
    "config/system.json",
    "generated/layout.json",
    "generated/power_budget.json",
    "docs/bom.csv",
    "docs/harness.csv",
    "docs/wiring-harness.svg",
    "docs/hardware.md",
    "docs/assembly.md",
    "docs/measurements.md",
    "docs/testing.md",
    "mechanical/exports/manifest.json",
    "mechanical/exports/controller_tray.stl",
    "mechanical/exports/controller_tray.step",
    "mechanical/exports/controller_lid.stl",
    "mechanical/exports/controller_lid.step",
    "mechanical/renders/controller_case.png",
    "mechanical/renders/vertical_strip_mount.png",
)


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def package_manufacturing(output: Path) -> dict[str, object]:
    records: list[dict[str, object]] = []
    contents: dict[str, bytes] = {}
    for relative in PACKAGE_FILES:
        path = ROOT / relative
        if not path.is_file():
            raise FileNotFoundError(relative)
        content = path.read_bytes()
        contents[relative] = content
        records.append({"path": relative, "bytes": len(content), "sha256": digest(content)})

    cad_manifest = json.loads(contents["mechanical/exports/manifest.json"])
    manifest: dict[str, object] = {
        "product": "NoteFall 88",
        "bundleType": "manufacturing",
        "bundleVersion": 1,
        "firmwareVersion": firmware_version(),
        "configSha256": digest(contents["config/system.json"]),
        "layoutSha256": digest(contents["generated/layout.json"]),
        "powerBudgetSha256": digest(contents["generated/power_budget.json"]),
        "cadManifestSha256": digest(contents["mechanical/exports/manifest.json"]),
        "privateSourcePhotosIncluded": False,
        "files": records,
    }
    if cad_manifest["config_sha256"] != manifest["configSha256"]:
        raise ValueError("CAD exports do not match config/system.json")
    if cad_manifest["layout_sha256"] != manifest["layoutSha256"]:
        raise ValueError("CAD exports do not match generated/layout.json")
    if cad_manifest["power_budget_sha256"] != manifest["powerBudgetSha256"]:
        raise ValueError("CAD exports do not match generated/power_budget.json")

    output.parent.mkdir(parents=True, exist_ok=True)
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with zipfile.ZipFile(output, "w") as archive:
        write_reproducible(archive, "manifest.json", manifest_bytes)
        for relative in PACKAGE_FILES:
            write_reproducible(archive, relative, contents[relative])
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = package_manufacturing(args.output)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
