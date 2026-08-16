# NoteFall 88 documentation

This is the English documentation set for **NoteFall 88**, a removable, non-destructive LED key-guidance system designed for the Casio PX-S7000.

The piano sends USB-MIDI directly to an ESP32-S3. The controller drives one vertical, exposed APA102C/SK9822 strip behind the keys and provides a Wi-Fi control surface. NoteFall Studio runs on a phone, tablet, or computer and supplies notation, piano roll, practice modes, recording, analysis, and library management.

> The physical piano uses one LED strip only. Falling notes are a screen visualization, not a multi-row fixture on the piano.

## Start here

- [System architecture](architecture.md)
- [Purchased hardware and electrical design](hardware.md)
- [First build and non-destructive installation](assembly.md)
- [Commissioning and LED calibration](commissioning.md)
- [Test and acceptance procedure](testing.md)
- [WebSocket protocol](protocol.md)
- [Music and practice features](studio.md)
- [Quality and performance evidence](quality-and-performance.md)

## Installation sequence

1. Inspect and bench-test the delivered parts with the piano disconnected.
2. Build and electrically test the controller and harness.
3. Temporarily position the strip on the piano; do not apply permanent adhesive yet.
4. Use the A0 / middle-C / C8 test lights to align the strip and complete calibration.
5. Verify full travel of every black and white key.
6. Make the final removable attachment, then repeat the three-point check.

The Chinese source documentation remains in `docs/`. English files are maintained in `docs/en/`; neither replaces the other.
