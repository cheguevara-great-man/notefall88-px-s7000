import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from scripts.flash_factory import EXPECTED_BOARD, esptool_commands, load_verified_image
from scripts.package_factory import (
    COMPONENT_OFFSETS,
    FACTORY_IMAGE_NAME,
    FLASH_BYTES,
    package_factory,
)
from scripts.package_update import NOTICE_FILES, ROOT


def components(tmp_path: Path) -> dict[str, Path]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    sizes = {
        "bootloader": 0x3000,
        "partitions": 0xC00,
        "boot_app": 0x2000,
        "firmware": 0x18000,
        "filesystem": 0x20000,
    }
    result: dict[str, Path] = {}
    for index, (name, size) in enumerate(sizes.items(), start=1):
        path = tmp_path / f"{name}.bin"
        path.write_bytes(bytes([index]) * size)
        result[name] = path
    return result


def build(tmp_path: Path, output_name: str = "factory.zip") -> tuple[Path, dict[str, object]]:
    parts = components(tmp_path)
    output = tmp_path / output_name
    manifest = package_factory(
        parts["bootloader"], parts["partitions"], parts["boot_app"],
        parts["firmware"], parts["filesystem"], output,
    )
    return output, manifest


def test_factory_bundle_is_single_image_checksummed_and_reproducible(tmp_path: Path) -> None:
    output, manifest = build(tmp_path)
    assert manifest["board"] == EXPECTED_BOARD
    assert manifest["flashBytes"] == FLASH_BYTES
    assert [record["offset"] for record in manifest["components"]] == [
        f"0x{offset:x}" for offset in COMPONENT_OFFSETS.values()
    ]
    with zipfile.ZipFile(output) as archive:
        assert {
            "factory-manifest.json", FACTORY_IMAGE_NAME, "flash_factory.py", "FLASHING.md",
            *NOTICE_FILES,
        }.issubset(archive.namelist())
        archived = json.loads(archive.read("factory-manifest.json"))
        assert archived == manifest
        image = archive.read(FACTORY_IMAGE_NAME)
        record = manifest["factoryImage"]
        assert len(image) == record["bytes"]
        assert hashlib.sha256(image).hexdigest() == record["sha256"]
        for component in manifest["components"]:
            offset = int(component["offset"], 0)
            end = offset + component["bytes"]
            assert hashlib.sha256(image[offset:end]).hexdigest() == component["sha256"]
        for notice in manifest["notices"]:
            assert archive.read(notice["path"]) == (ROOT / notice["path"]).read_bytes()

    second, _ = build(tmp_path / "second", "factory-copy.zip")
    assert hashlib.sha256(output.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()


def test_factory_packager_rejects_oversized_bootloader(tmp_path: Path) -> None:
    parts = components(tmp_path)
    parts["bootloader"].write_bytes(b"x" * (COMPONENT_OFFSETS["partitions.bin"] + 1))
    with pytest.raises(ValueError, match="bootloader.bin exceeds"):
        package_factory(
            parts["bootloader"], parts["partitions"], parts["boot_app"],
            parts["firmware"], parts["filesystem"], tmp_path / "bad.zip",
        )


def test_flash_helper_refuses_tampering_and_builds_exact_esp32s3_commands(tmp_path: Path) -> None:
    output, _ = build(tmp_path / "source")
    extracted = tmp_path / "extracted"
    with zipfile.ZipFile(output) as archive:
        archive.extractall(extracted)
    image, _ = load_verified_image(extracted)
    commands = esptool_commands("COM42", image)
    assert commands[0][-1] == "erase_flash"
    assert commands[1][-2:] == ["0x0", str(image)]
    assert "esp32s3" in commands[1]
    assert "8MB" in commands[1]

    image.write_bytes(image.read_bytes() + b"tampered")
    with pytest.raises(ValueError, match="大小"):
        load_verified_image(extracted)
