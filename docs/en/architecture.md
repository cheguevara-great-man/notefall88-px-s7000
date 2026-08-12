# Architecture

## Product boundary

NoteFall 88 separates latency-critical hardware from feature-rich practice software:

```text
PX-S7000 USB TO HOST -- USB-MIDI --> ESP32-S3 -- SPI --> 74AHCT125 --> APA102C/SK9822
                                         |
                                       Wi-Fi
                                         |
                       NoteFall Studio PWA / Android / iOS shell
```

The piano-to-light path is local to the ESP32-S3. A slow Wi-Fi connection must never delay live key feedback. Studio handles imported scores, rendering, practice state, recordings, reports, and the music library; it sends compact control and target-light messages to the controller.

## Responsibilities

| Layer | Responsibilities |
| --- | --- |
| PX-S7000 | Keyboard and pedal MIDI input; optional sound generator for MIDI output. |
| ESP32-S3 Core | USB host, timestamping, LED safety limits, APA102/SK9822 output, calibration persistence, diagnostics, local recovery UI. |
| NoteFall Studio | MusicXML/MIDI import, score and piano-roll views, real-time / wait / follow practice, recording, scoring, coaching and offline library. |
| Wire protocol | Versioned WebSocket messages, validation, diagnostics, time synchronization and explicit permission boundaries. |

## Physical LED model

The installed strip is a single serial chain with 176 addressable LEDs. It is physically made of three soldered sections: `32 + 72 + 72`. Two measured splice gaps are included in the generated mapping; the software does not pretend that every LED pitch is identical.

The mapping assigns each of the 88 piano keys a unique primary LED using actual white-key and black-key centres, not an incorrect equally-spaced chromatic grid. The user can reverse direction, apply a global pixel offset, and make bounded per-key corrections without recompiling firmware.

## Safety design

- LED power never passes through the ESP32-S3 board.
- A 74AHCT125 provides 3.3 V-to-5 V clock/data level conversion.
- Firmware owns the brightness ceiling and clears target lights on timeout, USB loss, parse error, or reboot.
- The piano USB connection carries MIDI only; it is not a power supply for the strip.
- Calibration and control traffic is authenticated on the device access point; home-network clients are read-only until explicitly authorized.
