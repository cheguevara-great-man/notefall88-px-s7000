from mechanical.model import build_parts, rail_dimensions
from scripts.generate import load_config


def test_all_printed_parts_fit_common_printer_and_are_valid():
    cfg = load_config()
    for part in build_parts(cfg).values():
        assert part.val().isValid()
        box = part.val().BoundingBox()
        assert box.xlen <= 220.0
        assert box.ylen <= 220.0


def test_seven_segments_make_one_full_rail():
    dims = rail_dimensions(load_config())
    assert dims.segment_count == 7
    assert abs(dims.segment_length * dims.segment_count - dims.total_length) < 1e-9
    assert dims.total_length >= 1222.0


def test_terminal_segments_are_flush_and_middle_has_one_tongue():
    cfg = load_config()
    parts = build_parts(cfg)
    dims = rail_dimensions(cfg)
    assert abs(parts["rail_left_end"].val().BoundingBox().xmin + dims.segment_length / 2) < 1e-6
    assert abs(parts["rail_right_end"].val().BoundingBox().xmax - dims.segment_length / 2) < 1e-6
    assert parts["rail_segment"].val().BoundingBox().xmax > dims.segment_length / 2
