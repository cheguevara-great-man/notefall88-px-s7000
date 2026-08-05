from mechanical.model import build_parts, controller_dimensions
from scripts.generate import load_config


def test_all_printed_parts_fit_common_printer_and_are_valid():
    cfg = load_config()
    for part in build_parts(cfg).values():
        assert part.val().isValid()
        box = part.val().BoundingBox()
        assert box.xlen <= 220.0
        assert box.ylen <= 220.0


def test_keyboard_mount_has_no_printed_rail_or_diffuser():
    parts = build_parts(load_config())
    assert set(parts) == {"controller_tray", "controller_lid"}


def test_vertical_strip_configuration_keeps_emitters_exposed():
    cfg = load_config()
    mech = cfg["mechanical"]
    assert mech["strip_mount"] == "vertical_exposed"
    assert float(mech["strip_orientation_deg"]) == 90.0
    assert float(mech["optional_carrier_height_mm"]) >= float(cfg["led"]["pcb_width_mm"])
    assert controller_dimensions(cfg).length <= 220.0
