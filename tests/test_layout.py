import json
from pathlib import Path

from mechanical.model import layout_from_config, load_config, logical_to_physical_map


ROOT = Path(__file__).resolve().parents[1]


def test_all_twelve_notes_have_unique_pixels_and_bounded_error():
    layout = layout_from_config(load_config())
    mapping = logical_to_physical_map(layout)
    assert len(set(mapping["nearest_pixel_in_row"])) == 12
    assert mapping["max_abs_mapping_error_mm"] <= layout.led_pitch_mm / 2 + 1e-9


def test_serpentine_rows_resolve_to_expected_strip_ranges():
    layout = layout_from_config(load_config())
    mapping = logical_to_physical_map(layout)
    for row, physical in enumerate(mapping["physical_pixel_by_row_note"]):
        assert all(row * layout.pixels_per_row <= value < (row + 1) * layout.pixels_per_row for value in physical)
        if row % 2 == 0:
            assert physical == sorted(physical)
        else:
            assert physical == sorted(physical, reverse=True)


def test_generated_layout_matches_source_math():
    generated = json.loads((ROOT / "mechanical" / "exports" / "layout.json").read_text(encoding="utf-8"))
    assert generated == logical_to_physical_map(layout_from_config(load_config()))

