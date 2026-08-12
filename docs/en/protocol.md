# Controller protocol

The controller exposes a versioned WebSocket protocol for Studio, a local recovery page, and diagnostics. The protocol is intentionally compact: Studio calculates practice targets; the ESP32 validates a message, applies safety limits and calibration, and drives pixels.

## Core message families

- `hello` / authorization: establishes protocol compatibility and scoped control access.
- Device status: firmware version, USB state, MIDI endpoints, signal counters, memory, reset reason, Wi-Fi strength, and safe diagnostics.
- MIDI event: timestamped keyboard and pedal events from the controller.
- Target frame: requested key targets and colors; invalid values are rejected and brightness is clamped by firmware.
- Calibration: strip direction, global offset, and bounded 88-key corrections.
- Time synchronization: ping/pong samples enable Studio to project ESP32 timestamps into browser time without treating network arrival time as musical timing.

The full normative Chinese protocol is [docs/protocol.md](../protocol.md). This English guide is a navigation document; generated protocol versions and tests are the authoritative implementation artifacts.
