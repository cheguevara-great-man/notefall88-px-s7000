from scripts.generate import build_layout, load_config


def test_all_88_notes_map_to_unique_pixels_with_bounded_error():
    config = load_config()
    layout = build_layout(config)
    assert layout["note_count"] == 88
    assert len(set(layout["pixel_by_note"])) == 88
    assert layout["max_abs_mapping_error_mm"] <= layout["maximum_led_center_gap_mm"] / 2.0 + 1e-9


def test_purchased_three_segment_strip_geometry_is_explicit():
    layout = build_layout(load_config())
    assert layout["segment_pixel_counts"] == [32, 72, 72]
    assert layout["splice_after_pixel_counts"] == [32, 104]
    assert abs(layout["strip_span_mm"] - 1230.4222222222222) < 1e-9
    for boundary, extra in zip(layout["splice_after_pixel_counts"], layout["splice_extra_gap_mm"]):
        actual = layout["led_centers_mm"][boundary] - layout["led_centers_mm"][boundary - 1]
        assert abs(actual - layout["led_pitch_mm"] - extra) < 1e-9


def test_mapping_is_strictly_monotonic():
    mapping = build_layout(load_config())["pixel_by_note"]
    assert all(right > left for left, right in zip(mapping, mapping[1:]))
