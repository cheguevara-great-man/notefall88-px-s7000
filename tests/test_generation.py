import json

from scripts.generate import EXPORT_DIR, FIXED_STEP_TIMESTAMP, sha256


def test_step_exports_have_reproducible_headers():
    for path in EXPORT_DIR.glob("*.step"):
        header = path.read_text(encoding="utf-8")[:512]
        assert FIXED_STEP_TIMESTAMP in header


def test_manifest_hashes_match_manufacturing_files():
    manifest = json.loads((EXPORT_DIR / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        assert sha256(EXPORT_DIR / entry["file"]) == entry["sha256"]
