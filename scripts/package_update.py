"""Build a checksummed NoteFall OTA bundle from PlatformIO binary images."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def write_reproducible(archive: zipfile.ZipFile, name: str, content: bytes) -> None:
    info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def firmware_version() -> str:
    text = (ROOT / "firmware" / "include" / "app_config.h").read_text(encoding="utf-8")
    match = re.search(r'kFirmwareVersion\[\]\s*=\s*"([^"]+)"', text)
    if not match:
        raise ValueError("kFirmwareVersion not found")
    return match.group(1)


def protocol_version() -> int:
    text = (ROOT / "firmware" / "include" / "app_config.h").read_text(encoding="utf-8")
    match = re.search(r"kProtocolVersion\s*=\s*(\d+)", text)
    if not match:
        raise ValueError("kProtocolVersion not found")
    return int(match.group(1))


def file_record(path: Path, target: str) -> dict[str, object]:
    content = path.read_bytes()
    return {
        "name": path.name,
        "target": target,
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def package_update(firmware: Path, filesystem: Path, output: Path) -> dict[str, object]:
    if not firmware.is_file() or not filesystem.is_file():
        raise FileNotFoundError("firmware.bin and littlefs.bin must both exist")
    manifest: dict[str, object] = {
        "product": "NoteFall 88",
        "bundleVersion": 1,
        "firmwareVersion": firmware_version(),
        "protocol": protocol_version(),
        "partitionTableSha256": hashlib.sha256(
            (ROOT / "firmware" / "partitions.csv").read_bytes()
        ).hexdigest(),
        "files": [
            file_record(filesystem, "filesystem"),
            file_record(firmware, "firmware"),
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        write_reproducible(
            archive,
            "manifest.json",
            (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        )
        write_reproducible(archive, filesystem.name, filesystem.read_bytes())
        write_reproducible(archive, firmware.name, firmware.read_bytes())
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--firmware", type=Path, required=True)
    parser.add_argument("--filesystem", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = package_update(args.firmware, args.filesystem, args.output)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
