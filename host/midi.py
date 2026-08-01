"""Standard MIDI file event extraction."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import mido

from .render import NoteEvent


def load_note_events(path: Path) -> list[NoteEvent]:
    midi = mido.MidiFile(path)
    active: dict[tuple[int, int], list[tuple[float, int]]] = defaultdict(list)
    events: list[NoteEvent] = []
    time_s = 0.0
    for message in midi:
        time_s += float(message.time)
        if message.type == "note_on" and message.velocity > 0:
            active[(message.channel, message.note)].append((time_s, message.velocity))
        elif message.type in ("note_off", "note_on"):
            key = (message.channel, message.note)
            if active[key]:
                start_s, velocity = active[key].pop(0)
                events.append(NoteEvent(message.note, start_s, max(start_s, time_s), velocity, message.channel))
    for (channel, note), starts in active.items():
        for start_s, velocity in starts:
            events.append(NoteEvent(note, start_s, time_s + 0.25, velocity, channel))
    return sorted(events, key=lambda event: (event.start_s, event.note, event.channel))

