"""Build a reproducible one-file factory image for a blank NoteFall controller."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path

try:
    from scripts.package_update import (
        NOTICE_FILES,
        ROOT,
        firmware_version,
        notice_record,
        protocol_version,
        write_reproducible,
    )
except ModuleNotFoundError:  # Direct invocation: python scripts/package_factory.py
    from package_update import (  # type: ignore[no-redef]
        NOTICE_FILES,
        ROOT,
        firmware_version,
        notice_record,
        protocol_version,
        write_reproducible,
    )


BOARD = "esp32-s3-devkitc-1-n8r8"
FLASH_BYTES = 8 * 1024 * 1024
FACTORY_IMAGE_NAME = "notefall88-factory.bin"
COMPONENT_OFFSETS = {
    "bootloader.bin": 0x0000,
    "partitions.bin": 0x8000,
    "boot_app0.bin": 0xE000,
    "firmware.bin": 0x10000,
    "littlefs.bin": 0x510000,
}


@dataclass(frozen=True)
class Partition:
    name: str
    offset: int
    size: int


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def parse_partitions(path: Path) -> dict[str, Partition]:
    rows: dict[str, Partition] = {}
    with path.open(encoding="utf-8", newline="") as source:
        for raw in csv.reader(line for line in source if not line.lstrip().startswith("#")):
            if not raw or len(raw) < 5:
                continue
            name, offset, size = raw[0].strip(), raw[3].strip(), raw[4].strip()
            if not name or not offset or not size:
                raise ValueError(f"partition row is incomplete: {raw}")
            rows[name] = Partition(name, int(offset, 0), int(size, 0))
    return rows


def build_factory_image(
    bootloader: Path,
    partitions_bin: Path,
    boot_app: Path,
    firmware: Path,
    filesystem: Path,
) -> tuple[bytes, list[dict[str, object]]]:
    paths = {
        "bootloader.bin": bootloader,
        "partitions.bin": partitions_bin,
        "boot_app0.bin": boot_app,
        "firmware.bin": firmware,
        "littlefs.bin": filesystem,
    }
    if missing := [name for name, path in paths.items() if not path.is_file()]:
        raise FileNotFoundError(f"factory components missing: {', '.join(missing)}")

    partition_table = parse_partitions(ROOT / "firmware" / "partitions.csv")
    app0 = partition_table["app0"]
    littlefs = partition_table["littlefs"]
    if app0.offset != COMPONENT_OFFSETS["firmware.bin"]:
        raise ValueError("app0 offset does not match the factory layout")
    if littlefs.offset != COMPONENT_OFFSETS["littlefs.bin"]:
        raise ValueError("LittleFS offset does not match the factory layout")

    contents = {name: path.read_bytes() for name, path in paths.items()}
    limits = {
        "bootloader.bin": COMPONENT_OFFSETS["partitions.bin"],
        "partitions.bin": 0x9000,
        "boot_app0.bin": COMPONENT_OFFSETS["firmware.bin"],
        "firmware.bin": app0.offset + app0.size,
        "littlefs.bin": littlefs.offset + littlefs.size,
    }
    for name, content in contents.items():
        start = COMPONENT_OFFSETS[name]
        if not content:
            raise ValueError(f"{name} is empty")
        if start + len(content) > limits[name]:
            raise ValueError(f"{name} exceeds its factory image region")

    image_end = max(COMPONENT_OFFSETS[name] + len(content) for name, content in contents.items())
    if image_end > FLASH_BYTES:
        raise ValueError("factory image exceeds the 8 MB flash")
    image = bytearray(b"\xff" * image_end)
    records: list[dict[str, object]] = []
    for name in COMPONENT_OFFSETS:
        content = contents[name]
        offset = COMPONENT_OFFSETS[name]
        image[offset : offset + len(content)] = content
        records.append({
            "name": name,
            "offset": f"0x{offset:x}",
            "bytes": len(content),
            "sha256": sha256(content),
        })
    return bytes(image), records


def package_factory(
    bootloader: Path,
    partitions_bin: Path,
    boot_app: Path,
    firmware: Path,
    filesystem: Path,
    output: Path,
) -> dict[str, object]:
    image, components = build_factory_image(
        bootloader, partitions_bin, boot_app, firmware, filesystem
    )
    manifest: dict[str, object] = {
        "product": "NoteFall 88",
        "bundleVersion": 1,
        "board": BOARD,
        "flashBytes": FLASH_BYTES,
        "firmwareVersion": firmware_version(),
        "protocol": protocol_version(),
        "factoryImage": {
            "name": FACTORY_IMAGE_NAME,
            "offset": "0x0",
            "bytes": len(image),
            "sha256": sha256(image),
        },
        "partitionTableSha256": sha256(
            (ROOT / "firmware" / "partitions.csv").read_bytes()
        ),
        "components": components,
        "notices": [notice_record(relative) for relative in NOTICE_FILES],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        write_reproducible(
            archive,
            "factory-manifest.json",
            (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        )
        write_reproducible(archive, FACTORY_IMAGE_NAME, image)
        write_reproducible(archive, "flash_factory.py", (ROOT / "scripts" / "flash_factory.py").read_bytes())
        write_reproducible(archive, "FLASHING.md", (ROOT / "docs" / "factory-flashing.md").read_bytes())
        for relative in NOTICE_FILES:
            write_reproducible(archive, relative, (ROOT / relative).read_bytes())
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootloader", type=Path, required=True)
    parser.add_argument("--partitions", type=Path, required=True)
    parser.add_argument("--boot-app", type=Path, required=True)
    parser.add_argument("--firmware", type=Path, required=True)
    parser.add_argument("--filesystem", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = package_factory(
        args.bootloader,
        args.partitions,
        args.boot_app,
        args.firmware,
        args.filesystem,
        args.output,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
