from host.render import FrameRenderer, NoteEvent


def lit_rows(frame, note_index):
    return [row for row, colors in enumerate(frame) if colors[note_index] != (0, 0, 0)]


def test_future_note_moves_from_far_to_near():
    renderer = FrameRenderer()
    event = NoteEvent(note=60, start_s=2.0, end_s=2.25, velocity=127)
    far = renderer.render([event], 0.95)
    middle = renderer.render([event], 1.30)
    near = renderer.render([event], 1.65)
    current = renderer.render([event], 2.0)
    assert lit_rows(far, 0) == [3]
    assert 2 in lit_rows(middle, 0)
    assert 1 in lit_rows(near, 0)
    assert 0 in lit_rows(current, 0)


def test_out_of_range_note_is_ignored():
    renderer = FrameRenderer()
    frame = renderer.render([NoteEvent(note=21, start_s=1.0, end_s=2.0)], 1.0)
    assert all(color == (0, 0, 0) for row in frame for color in row)

