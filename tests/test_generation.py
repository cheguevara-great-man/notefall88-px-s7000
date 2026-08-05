import json

from mechanical.model import controller_dimensions, lid_fastener_centres
from scripts.generate import EXPORT_DIR, FIXED_STEP_TIMESTAMP, sha256
from scripts.generate import load_config


def test_step_exports_have_reproducible_headers():
    for path in EXPORT_DIR.glob("*.step"):
        header = path.read_text(encoding="utf-8")[:512]
        assert FIXED_STEP_TIMESTAMP in header


def test_manifest_hashes_match_manufacturing_files():
    manifest = json.loads((EXPORT_DIR / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        assert sha256(EXPORT_DIR / entry["file"]) == entry["sha256"]


def test_lid_skirt_and_fasteners_fit_inside_tray():
    dimensions = controller_dimensions(load_config())
    tray_inner_length = dimensions.length - 2 * dimensions.wall
    tray_inner_width = dimensions.width - 2 * dimensions.wall
    skirt_outer_length = tray_inner_length - dimensions.lid_clearance
    skirt_outer_width = tray_inner_width - dimensions.lid_clearance
    assert 0.2 <= (tray_inner_length - skirt_outer_length) / 2 <= 0.3
    assert 0.2 <= (tray_inner_width - skirt_outer_width) / 2 <= 0.3
    assert dimensions.lid_screw_pilot < dimensions.lid_screw_diameter
    assert dimensions.lid_boss_height >= dimensions.height - dimensions.lid_thickness
    for x, y in lid_fastener_centres(dimensions):
        radius = dimensions.lid_boss_diameter / 2
        assert abs(x) + radius < tray_inner_length / 2
        assert abs(y) + radius < tray_inner_width / 2
