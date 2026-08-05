"""Cross-check real MusicXML note pitches/onsets against independent music21.

The reference corpus is intentionally external and pinned in docs/musicxml.md;
no third-party score is copied into NoteFall release artifacts.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

from music21 import chord, converter, note


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DEFAULT_CORPUS = ROOT / "tmp" / "opensheetmusicdisplay" / "test" / "data"
DEFAULT_SCORES = [
    "MuzioClementi_SonatinaOpus36No1_Part1.xml",
    "MuzioClementi_SonatinaOpus36No1_Part2.xml",
    "MuzioClementi_SonatinaOpus36No3_Part1.xml",
    "MuzioClementi_SonatinaOpus36No3_Part2.xml",
    "Debussy_Mandoline.xml",
    "Gretchaninov_A_Boring_Story.musicxml",
]
MAX_ONSET_ERROR_SECONDS = 0.002


def notefall_score(path: Path) -> dict:
    command = [
        "npx.cmd" if sys.platform == "win32" else "npx",
        "vite-node",
        "scripts/export-musicxml-score.ts",
        str(path),
    ]
    completed = subprocess.run(
        command,
        cwd=WEB,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(completed.stdout)


def reference_events(path: Path) -> list[tuple[float, int]]:
    score = converter.parse(path)
    try:
        score = score.expandRepeats()
    except Exception:
        if b"<repeat" in path.read_bytes():
            raise
    score = score.stripTies(inPlace=False, matchByPitch=True)
    events: list[tuple[float, int]] = []
    for item in score.flatten().secondsMap:
        element = item["element"]
        pitches = [element.pitch] if isinstance(element, note.Note) else (
            list(element.pitches) if isinstance(element, chord.Chord) else []
        )
        for pitch in pitches:
            if 21 <= pitch.midi <= 108:
                events.append((float(item["offsetSeconds"]), int(pitch.midi)))
    return sorted(events)


def crosscheck(path: Path) -> tuple[dict, bool]:
    actual = notefall_score(path)
    notefall = sorted((float(item["start"]), int(item["note"])) for item in actual["notes"])
    reference = reference_events(path)
    notefall_histogram = Counter(pitch for _, pitch in notefall)
    reference_histogram = Counter(pitch for _, pitch in reference)
    maximum_onset_error = max(
        (abs(left[0] - right[0]) for left, right in zip(notefall, reference)),
        default=0.0,
    )
    passed = (
        len(notefall) == len(reference)
        and [pitch for _, pitch in notefall] == [pitch for _, pitch in reference]
        and notefall_histogram == reference_histogram
        and maximum_onset_error <= MAX_ONSET_ERROR_SECONDS
    )
    return {
        "file": path.name,
        "notefallNotes": len(notefall),
        "music21Notes": len(reference),
        "pitchSequenceMatch": [pitch for _, pitch in notefall]
        == [pitch for _, pitch in reference],
        "maximumOnsetErrorSeconds": maximum_onset_error,
        "passed": passed,
    }, passed


def main(arguments: list[str]) -> int:
    paths = [Path(argument).resolve() for argument in arguments]
    if not paths:
        paths = [DEFAULT_CORPUS / name for name in DEFAULT_SCORES]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        print(json.dumps({"missingScores": missing}, ensure_ascii=False, indent=2))
        return 2
    results: list[dict] = []
    passed = True
    for path in paths:
        result, score_passed = crosscheck(path)
        results.append(result)
        passed &= score_passed
    print(json.dumps({
        "reference": "music21 9.9.1",
        "maximumAllowedOnsetErrorSeconds": MAX_ONSET_ERROR_SECONDS,
        "scores": results,
        "totalNotes": sum(result["notefallNotes"] for result in results),
        "passed": passed,
    }, ensure_ascii=False, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
