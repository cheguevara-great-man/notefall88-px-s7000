# Pop-transcription fallback library

This folder is deliberately separate from the verified human-performance
library. A file here is a score/transcription MIDI, never a claim that the
artist or a pianist performed it live into MIDI.

## Admission rule

Only add a file after all of the following are recorded in its adjacent
`metadata.json`:

1. A lawful source URL and its arranger/uploader attribution.
2. The original work, arranger, and explicit classification
   `score_transcription_fallback`.
3. A full-file audit from `tools/audit_transcription_midi.py` that passes:
   - at least 90 seconds and 300 note-on events;
   - piano-only GM program data, with no drum-channel notes;
   - at least four distinct note velocities;
   - no silent conversion, re-timing, quantisation, or AI transcription by
     NoteFall.
4. A manual listen-through confirming it is a coherent solo-piano
   arrangement rather than a short demo or a backing-track reduction.

CC64 sustain pedal is preferred but not mandatory for an authored score
transcription. The metadata must state its actual presence.

## Rejected sources and files

The following are useful search leads but **not library entries**:

| Source | Finding | Decision |
| --- | --- | --- |
| MIDI云, `周杰伦系列 - 钢琴` | Returned 20–51-second demo clips instead of complete files. | Rejected as preview material. |
| MIDI云, `光年之外 - 邓紫棋 - 钢琴` | 211 notes, one fixed velocity, no CC64. | Rejected as low-expression excerpt. |
| Online Sequencer, `夜曲` | Export had synth/guitar programs, three velocity values, no CC64. | Rejected as non-piano instrumental reduction. |
| PianoSnap `夜曲` solo arrangement | A full score/MIDI product exists but requires a separate paid checkout. | Do not acquire without explicit purchase authority. |

The point of this registry is to prevent a low-quality fallback from ever
being mislabeled as a verified performance MIDI merely because it has a
popular title.
