"""Convert score-time note events into the four-row falling-note logical frame."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]


@dataclasses.dataclass(frozen=True)
class NoteEvent:
    note: int
    start_s: float
    end_s: float
    velocity: int = 100
    channel: int = 0


def _scale_color(color: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    amount = max(0.0, min(1.0, amount))
    return tuple(round(component * amount) for component in color)


def _max_color(a: tuple[int, int, int], b: tuple[int, int, int]) -> tuple[int, int, int]:
    return tuple(max(x, y) for x, y in zip(a, b))


def event_color(event: NoteEvent) -> tuple[int, int, int]:
    # Channel 1 is conventionally used for a separately imported left-hand track.
    # For single-track files, pitch gives a useful but non-semantic visual split.
    if event.channel == 1 or event.note < 60:
        return (255, 96, 18)
    return (28, 164, 255)


class FrameRenderer:
    def __init__(self, config_path: Path | None = None) -> None:
        config_path = config_path or ROOT / "config" / "system.json"
        cfg = json.loads(config_path.read_text(encoding="utf-8"))
        proto = cfg["prototype"]
        self.first_note = int(proto["first_midi_note"])
        self.note_count = int(proto["note_count"])
        self.lookahead_s = [float(value) / 1000.0 for value in proto["lookahead_ms"]]
        if not self.lookahead_s or self.lookahead_s[0] != 0.0:
            raise ValueError("lookahead row 0 must represent the current time")
        if any(b <= a for a, b in zip(self.lookahead_s, self.lookahead_s[1:])):
            raise ValueError("lookahead rows must be strictly increasing")

    @property
    def row_count(self) -> int:
        return len(self.lookahead_s)

    def blank(self) -> list[list[tuple[int, int, int]]]:
        return [[(0, 0, 0) for _ in range(self.note_count)] for _ in self.lookahead_s]

    def _row_weights(self, delta_s: float) -> list[tuple[int, float]]:
        if delta_s < 0.0 or delta_s > self.lookahead_s[-1]:
            return []
        for upper in range(1, len(self.lookahead_s)):
            lower_t = self.lookahead_s[upper - 1]
            upper_t = self.lookahead_s[upper]
            if delta_s <= upper_t:
                fraction = (delta_s - lower_t) / (upper_t - lower_t)
                return [(upper - 1, 1.0 - fraction), (upper, fraction)]
        return [(len(self.lookahead_s) - 1, 1.0)]

    def render(self, events: Iterable[NoteEvent], now_s: float) -> list[list[tuple[int, int, int]]]:
        frame = self.blank()
        for event in events:
            note_index = event.note - self.first_note
            if not 0 <= note_index < self.note_count:
                continue
            velocity_scale = max(0.08, min(1.0, event.velocity / 127.0))
            base = _scale_color(event_color(event), velocity_scale)
            if event.start_s <= now_s <= event.end_s:
                frame[0][note_index] = _max_color(frame[0][note_index], base)
            delta = event.start_s - now_s
            for row, weight in self._row_weights(delta):
                candidate = _scale_color(base, weight)
                frame[row][note_index] = _max_color(frame[row][note_index], candidate)
        return frame

