#!/usr/bin/env python3
"""Audit a candidate score-transcription MIDI before it enters NoteFall.

This is intentionally stricter than "the file opens".  It keeps the
performance library separate from scored/transcribed material and rejects
common web traps: thirty-second previews, drum/backing-track files and MIDI
files whose every note has the same velocity.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mido


def audit(path: Path) -> dict[str, object]:
    midi = mido.MidiFile(path)
    notes: list[int] = []
    controls: list[int] = []
    programs: set[int] = set()
    drum_events = 0
    for track in midi.tracks:
        for event in track:
            if event.type == "note_on" and event.velocity > 0:
                notes.append(event.velocity)
                if event.channel == 9:
                    drum_events += 1
            elif event.type == "control_change":
                controls.append(event.control)
            elif event.type == "program_change":
                programs.add(event.program)

    duration = midi.length
    varied_velocity = len(set(notes)) >= 4
    piano_only = bool(programs) and programs.issubset(set(range(0, 8)))
    complete = duration >= 90 and len(notes) >= 300
    verdict = complete and piano_only and drum_events == 0 and varied_velocity
    reasons: list[str] = []
    if duration < 90:
        reasons.append("shorter_than_90_seconds_likely_preview_or_excerpt")
    if len(notes) < 300:
        reasons.append("too_few_notes_for_complete_piano_arrangement")
    if not piano_only:
        reasons.append("not_piano_only_or_missing_program_metadata")
    if drum_events:
        reasons.append("contains_drum_channel_events")
    if not varied_velocity:
        reasons.append("fixed_or_nearly_fixed_velocity")
    return {
        "file": str(path),
        "midi_format": midi.type,
        "duration_seconds": round(duration, 3),
        "note_on_events": len(notes),
        "velocity_distinct_values": len(set(notes)),
        "velocity_range": [min(notes), max(notes)] if notes else None,
        "cc64_sustain_events": controls.count(64),
        "programs": sorted(programs),
        "drum_note_events": drum_events,
        "quality_gate_pass": verdict,
        "rejection_reasons": reasons,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("midi", type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.midi), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
