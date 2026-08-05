import json

from scripts.generate import GENERATED_DIR, build_power_budget, load_config


def test_power_cap_fits_final_supply_with_margin():
    cfg = load_config()
    budget = build_power_budget(cfg)
    assert budget["supply_utilization_percent"] < 60.0
    assert budget["design_current_a"] < budget["fuse_a"] * 0.8
    assert budget["fuse_a"] <= budget["wire_conservative_a"]
    assert budget["worst_branch_drop_percent"] <= cfg["power"]["max_voltage_drop_percent"]


def test_checked_in_power_budget_matches_generator():
    expected = build_power_budget(load_config())
    actual = json.loads((GENERATED_DIR / "power_budget.json").read_text(encoding="utf-8"))
    assert actual == expected


def test_spi_refresh_is_well_under_one_millisecond():
    cfg = load_config()
    pixels = cfg["led"]["pixel_count"]
    end_bytes = max(4, (pixels + 15) // 16)
    frame_bytes = 4 + pixels * 4 + end_bytes
    frame_ms = frame_bytes * 8 / cfg["led"]["spi_hz"] * 1000
    assert frame_ms < 1.0
