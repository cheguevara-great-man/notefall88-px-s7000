import json
import hashlib
import zipfile
from pathlib import Path

from scripts.package_update import firmware_version, package_update


def test_update_bundle_contains_checksums_and_version(tmp_path: Path) -> None:
    firmware = tmp_path / "firmware.bin"
    filesystem = tmp_path / "littlefs.bin"
    firmware.write_bytes(b"firmware" * 200)
    filesystem.write_bytes(b"filesystem" * 200)
    output = tmp_path / "notefall88-update.zip"
    manifest = package_update(firmware, filesystem, output)

    assert manifest["product"] == "NoteFall 88"
    assert manifest["bundleVersion"] == 1
    assert manifest["firmwareVersion"] == firmware_version()
    with zipfile.ZipFile(output) as archive:
        archived = json.loads(archive.read("manifest.json"))
        assert archived == manifest
        assert archive.read("firmware.bin") == firmware.read_bytes()
        assert archive.read("littlefs.bin") == filesystem.read_bytes()

    second = tmp_path / "notefall88-update-copy.zip"
    package_update(firmware, filesystem, second)
    assert hashlib.sha256(output.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()
