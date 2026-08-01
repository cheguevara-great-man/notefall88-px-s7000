"""NoteFall V0 command-line driver for demo patterns and Standard MIDI files."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import serial
from serial.tools import list_ports

from .midi import load_note_events
from .protocol import encode_logical_frame
from .render import FrameRenderer, NoteEvent


def demo_events(seconds: float, first_note: int, note_count: int) -> list[NoteEvent]:
    events: list[NoteEvent] = []
    index = 0
    start = 1.1
    while start < seconds + 1.1:
        note = first_note + (index % note_count)
        events.append(NoteEvent(note, start, start + 0.28, 104, index % 2))
        index += 1
        start += 0.42
    return events


def serial_ports() -> list[dict[str, str]]:
    return [
        {
            "device": port.device,
            "description": port.description,
            "hwid": port.hwid,
        }
        for port in list_ports.comports()
    ]


def play(
    events: list[NoteEvent],
    seconds: float,
    port: str | None,
    baud: int,
    frame_hz: float,
    brightness: int,
    dry_run: bool,
) -> None:
    renderer = FrameRenderer()
    frame_count = max(1, round(seconds * frame_hz))
    serial_link = None if dry_run else serial.Serial(port=port, baudrate=baud, timeout=0)
    lit_samples = 0
    try:
        start_clock = time.perf_counter()
        for sequence in range(frame_count):
            score_time = sequence / frame_hz
            frame = renderer.render(events, score_time)
            lit_samples += sum(color != (0, 0, 0) for row in frame for color in row)
            packet = encode_logical_frame(sequence, frame, brightness)
            if serial_link is not None:
                serial_link.write(packet)
                deadline = start_clock + (sequence + 1) / frame_hz
                remaining = deadline - time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
        if serial_link is not None:
            blank = renderer.blank()
            serial_link.write(encode_logical_frame(frame_count, blank, brightness))
    finally:
        if serial_link is not None:
            serial_link.close()
    print(
        json.dumps(
            {
                "mode": "dry-run" if dry_run else "serial",
                "frames": frame_count,
                "frame_hz": frame_hz,
                "duration_s": seconds,
                "events": len(events),
                "lit_logical_samples": lit_samples,
                "global_brightness": brightness,
                "port": port,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("ports", help="list serial ports")

    for command in ("demo", "midi"):
        sub = subparsers.add_parser(command)
        sub.add_argument("--port", help="ESP32 serial device, for example COM6")
        sub.add_argument("--baud", type=int, default=921600)
        sub.add_argument("--frame-hz", type=float, default=50.0)
        sub.add_argument("--brightness", type=int, default=4, choices=range(0, 5))
        sub.add_argument("--seconds", type=float, default=8.0)
        sub.add_argument("--dry-run", action="store_true")
    midi_parser = subparsers.choices["midi"]
    midi_parser.add_argument("file", type=Path)

    args = parser.parse_args()
    if args.command == "ports":
        print(json.dumps(serial_ports(), ensure_ascii=False, indent=2))
        return
    if not args.dry_run and not args.port:
        parser.error("--port is required unless --dry-run is used")
    renderer = FrameRenderer()
    if args.command == "demo":
        events = demo_events(args.seconds, renderer.first_note, renderer.note_count)
    else:
        events = load_note_events(args.file)
    play(events, args.seconds, args.port, args.baud, args.frame_hz, args.brightness, args.dry_run)


if __name__ == "__main__":
    main()

