from scripts.generate import build_layout, load_config


def test_all_88_notes_map_to_unique_pixels_with_bounded_error():
    config = load_config()
    layout = build_layout(config)
    assert layout["note_count"] == 88
    assert len(set(layout["pixel_by_note"])) == 88
    assert layout["max_abs_mapping_error_mm"] <= layout["led_pitch_mm"] / 2.0 + 1e-9


def test_keyboard_and_strip_spans_are_nearly_identical():
    layout = build_layout(load_config())
    assert abs(layout["strip_span_mm"] - layout["keybed_span_mm"]) < 1.0


def test_mapping_is_strictly_monotonic():
    mapping = build_layout(load_config())["pixel_by_note"]
    assert all(right > left for left, right in zip(mapping, mapping[1:]))
