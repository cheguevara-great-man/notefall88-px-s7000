# Controller protocol

The controller exposes a versioned WebSocket protocol for Studio, a local recovery page, and diagnostics. The protocol is intentionally compact: Studio calculates practice targets; the ESP32 validates a message, applies safety limits and calibration, and drives pixels.

## Core message families

- `hello` / authorization: establishes protocol compatibility and scoped control access.
- Device status: firmware version, USB state, MIDI endpoints, signal counters, memory, reset reason, Wi-Fi strength, and safe diagnostics.
- MIDI event: timestamped keyboard and pedal events from the controller.
- Target frame: requested key targets and colors; invalid values are rejected and brightness is clamped by firmware.
- Calibration: strip direction, global offset, and bounded 88-key corrections.
- Time synchronization: ping/pong samples enable Studio to project ESP32 timestamps into browser time without treating network arrival time as musical timing.

## Real-time transport and observability

USB host daemon events, USB MIDI client events, the Core 0 MIDI/LED pipeline, and the Core 1 Arduino network loop are isolated from one another. A USB packet wakes the real-time task directly; all events already in the fixed queue are merged into one coherent LED frame before JSON or WebSocket work runs. The 176-pixel APA102 frame remains exactly 719 bytes at 8 MHz with the same BGR and 5-bit brightness semantics, but is emitted as one bulk hardware-SPI operation and unchanged idle frames are skipped.

Additive protocol-v6 status fields expose USB input/output queue depth and high-water marks, callback-to-dispatch and callback-to-LED latency, SPI duration/frame count, real-time heartbeat/stack/watchdog state, and browser MIDI queue depth/drop/resynchronization counters. The USB client wakes the higher-priority real-time task once after a complete transfer is queued, retaining one-frame chords without allowing sustained input to starve LED rendering. Browser forwarding uses a fixed 128-event queue and a bounded batch per loop; after an extreme overflow it clears CC64/66/67/123 on every channel and reconstructs held keys with the existing messages, so older v6 clients recover without learning a new message type. USB loss immediately clears held, target, and test LEDs before the disconnected state is published.

The full normative Chinese protocol is [docs/protocol.md](../protocol.md). This English guide is a navigation document; generated protocol versions and tests are the authoritative implementation artifacts.
