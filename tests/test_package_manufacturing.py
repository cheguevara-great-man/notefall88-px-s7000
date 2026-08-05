import hashlib
import json
import zipfile
from pathlib import Path

from scripts.package_manufacturing import PACKAGE_FILES, package_manufacturing


def test_manufacturing_bundle_is_complete_private_and_reproducible(tmp_path: Path) -> None:
    first = tmp_path / "manufacturing-a.zip"
    second = tmp_path / "manufacturing-b.zip"
    manifest = package_manufacturing(first)
    package_manufacturing(second)

    assert manifest["bundleType"] == "manufacturing"
    assert manifest["privateSourcePhotosIncluded"] is False
    assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()
    with zipfile.ZipFile(first) as archive:
        assert set(archive.namelist()) == {"manifest.json", *PACKAGE_FILES}
        assert json.loads(archive.read("manifest.json")) == manifest
        assert archive.getinfo("manifest.json").date_time == (1980, 1, 1, 0, 0, 0)


def test_manufacturing_manifest_checksums_every_file(tmp_path: Path) -> None:
    output = tmp_path / "manufacturing.zip"
    manifest = package_manufacturing(output)
    with zipfile.ZipFile(output) as archive:
        for record in manifest["files"]:
            content = archive.read(record["path"])
            assert len(content) == record["bytes"]
            assert hashlib.sha256(content).hexdigest() == record["sha256"]
