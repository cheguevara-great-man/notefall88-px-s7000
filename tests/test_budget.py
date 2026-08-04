from scripts.generate import load_config


def test_power_cap_fits_final_supply_with_margin():
    cfg = load_config()
    pixels = cfg["led"]["pixel_count"]
    max_full_white = pixels * cfg["power"]["conservative_full_white_w_per_pixel"]
    capped = max_full_white * cfg["led"]["max_global_brightness"] / 31.0
    supply = cfg["power"]["supply_v"] * cfg["power"]["supply_a"]
    assert capped < supply * 0.6


def test_spi_refresh_is_well_under_one_millisecond():
    cfg = load_config()
    pixels = cfg["led"]["pixel_count"]
    end_bytes = max(4, (pixels + 15) // 16)
    frame_bytes = 4 + pixels * 4 + end_bytes
    frame_ms = frame_bytes * 8 / cfg["led"]["spi_hz"] * 1000
    assert frame_ms < 1.0
