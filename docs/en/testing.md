# Test and acceptance

## Electrical tests

- Power off: verify no 5 V-to-GND short, connector polarity, fuse rating, and capacitor polarity.
- Power on at the firmware brightness limit: inspect every LED, measure for unexpected heating, and test both ends of power injection.
- Exercise the cable harness gently; lights must not flicker and no force may reach a strip solder pad.

## Functional tests

- USB MIDI enumeration, keyboard Note On/Off, pedal CC64, disconnect/reconnect.
- A0/C4/C8 anchors plus all 88-key calibration sweep.
- Real-time, Wait for Me, Follow Me, part filtering, loop, tempo, transpose, recording and playback.
- Score-only, piano-roll-only, and combined tablet layouts.
- Wi-Fi reconnect, browser refresh, offline library recovery and settings persistence.

## Safety tests

- Full travel of every black and white key with the fixture installed.
- Controller clears lights on watchdog reset, USB loss, WebSocket target timeout, and invalid input.
- Confirm that loss of the tablet or Wi-Fi cannot prevent physical key feedback from functioning safely.

Record each result in the Chinese deployment checklist (`docs/deploy/arrival-checklist.md`).
