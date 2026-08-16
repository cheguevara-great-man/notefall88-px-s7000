# Quality and performance evidence

This report records the current, auditable quality baseline for NoteFall 88. It separates properties demonstrated by source inspection and automation from results that can only be measured on the delivered ESP32-S3, LED strip, and PX-S7000. A passing software gate is not presented as proof of physical latency, thermal safety, optical comfort, or piano compatibility.

The continuously updated release decision remains in the [release-readiness gate](../release-readiness.md). See also the [system architecture](architecture.md), [protocol](protocol.md), [Studio guide](studio.md), [test procedure](testing.md), [competitive benchmark](../competitive-benchmark.md), and [completion audit](../completion-audit.md).

## Large-tablet visual path

The primary tablet target is the Xiaomi Pad 7 Ultra: a 3200 x 2136, approximately 3:2 panel. At a device-pixel ratio of 2 this corresponds to a 1600 x 1068 CSS viewport, so browser automation exercises both that representative viewport and the full physical-pixel dimensions as a worst-case 1x layout stress test. The same smoke suite also covers 390 x 844 and 1280 x 900.

Studio supports notation-only, waterfall-only, and split views. Focus mode removes the top bar, transport, and score strip from layout rather than merely making them transparent. At 3200 x 2136, the browser probe measured a 2130 px-high performance surface starting 3 px from the top. At 1600 x 1068, notation-only mode occupies at least 90% of its container without horizontal overflow. Controls use tablet-sized touch targets, the layout remains usable with browser fullscreen denied, and CSS includes reduced-motion and increased-contrast adaptations.

The browser renderer keeps coordinates in CSS pixels while [`canvasRasterSize`](../../web/src/layout.ts) limits device-pixel ratio to 2 and backing-store area to 7,500,000 pixels. The Pad target at 1600 x 1068 and DPR 2 needs 3200 x 2136, or 6,835,200 backing pixels, and therefore retains full 2x detail within the budget. Extremely large or unusual display scales are reduced rather than allowing an unbounded multi-megapixel surface to be repainted continuously.

## Rendering work is bounded

The web [`waterfall renderer`](../../web/src/waterfall.ts) does not scan an entire long score on every frame. Notes, beats, chords, and pedal events are time ordered; binary lower-bound searches select only the visible window, including notes that began before the window but are still held. Key geometry is indexed for constant-time lookup. When more than 160 notes are visible, the renderer selects a simpler dense-frame drawing path instead of constructing the most expensive rounded and gradient shapes for every note.

The [`render scheduler`](../../web/src/render-scheduler.ts) is dirty/event driven when playback is idle. It paints continuously only while the score clock, demonstration, recorded-performance replay, or feedback animation is active. High-refresh displays are gated to at most approximately 60 expensive Canvas paints per second; idle diagnostics request a refresh every 500 ms, and sheet-follow scrolling is coalesced to no more than once per 80 ms. Canvas contexts request an opaque, desynchronized surface where the browser supports it. These are deterministic workload gates, not a claim that every device has already sustained 60 fps under every score.

Browser smoke tests cover Chromium and WebKit across the four viewports above, real MusicXML/OSMD rendering, long-score following, repeated measures, dynamics, cross-hand chord guides, early/late feedback, release feedback, and the three view modes. They assert layout and rendered evidence; hardware GPU timing, battery use, and thermal throttling remain device measurements.

## Native Android path

The Android package is more than a WebView-only wrapper for the performance surface. [`NativeWaterfallPlugin`](../../studio/android/app/src/main/java/io/notefall/studio/NativeWaterfallPlugin.java) installs a hardware-accelerated native `View`, advances playback from Android's monotonic clock between lower-rate bridge updates, sorts and window-prunes notes, beats, and pedal events, and reuses cached gradients. Its animated-paint gate has a 15 ms minimum interval. App lifecycle and immersive-system-bar behavior are bridged explicitly, while the PWA/Canvas implementation remains a compatible fallback and desktop route.

The Android debug build proves compilation and packaging of this native path. It does not prove Xiaomi-specific sustained frame time, hotspot reconnection after lock-screen transitions, signed release installation, or the still-pending iOS native/signing path.

## Practice claims use evidence, not a raw percentage

The [`practice evidence model`](../../web/src/practice-evidence.ts) uses a 95% Wilson interval so a tiny perfect or failed sample cannot masquerade as certainty. Automated boundary examples include 0/10 attempts with an upper bound of 27.8% and 10/10 with a lower bound of 72.2%.

Confidence and coaching use explicit gates:

| Decision | Gate |
|---|---|
| High confidence | complete telemetry, at least 5 sessions, at least 80 judged attempts, and Wilson interval width no greater than 14 percentage points |
| Medium confidence | complete telemetry, at least 2 sessions, at least 20 attempts, and interval width no greater than 28 points |
| Improving or declining | absolute change of at least 4 percentage points, with non-overlapping recent and older Wilson intervals in the claimed direction |
| Automatic tempo increase | complete telemetry, lower 95% accuracy bound at least 88%, no declining trend, and session consistency at least 70 when available |

Imported duplicate sessions are deduplicated, session consistency is reported separately, and any dropped or truncated event makes telemetry incomplete and blocks automatic tempo increases. Whole-piece mastery and spaced-practice decisions additionally require meaningful score coverage, so a short repeated loop cannot promote the entire piece. These rules make recommendations conservative and explainable; they are learning aids, not medical or psychometric certification.

## Firmware real-time path and observability

The ESP32-S3 native USB Host callback records a timestamp, places the complete USB transfer into fixed storage, and wakes a dedicated Core 0 real-time task. That task merges the queued batch into one coherent LED frame before browser/network JSON work runs on the Arduino loop. USB input and output queues each have capacity 128, the browser-forwarding queue has capacity 128, and scheduled MIDI output has capacity 256. The real-time task uses a 6144-byte stack, priority 7, and a 5 ms idle poll. Network congestion therefore cannot directly block the USB-to-LED critical section.

One 176-pixel APA102/SK9822 frame is exactly 719 bytes. At 8 MHz, its theoretical wire time is 0.719 ms, inside the `< 1 ms` digital budget; unchanged idle frames are skipped. This calculation excludes task wake-up, processing, and hardware-library overhead, so the firmware reports the real SPI last/max duration rather than treating the calculation as a physical measurement.

Additive optional protocol-v6 status fields expose:

- USB input/output queue depth and high-water marks, the largest input batch, resubmit retries, and client/daemon watchdog state;
- callback-to-MIDI-dispatch and callback-to-LED-SPI-complete latency, including last/average/max samples;
- LED frame count, skipped frames, SPI last/max duration, and frame bytes;
- browser MIDI queue depth, high-water mark, drops, and recovery resynchronizations;
- real-time task readiness, watchdog, heartbeat age, wakeups, and free stack; and
- current and maximum Arduino main-loop duration.

All new fields are optional and the protocol version is unchanged, preserving compatibility with older firmware and web clients. Queue growth, drops, watchdogs, and stack margin are acceptance evidence: a larger queue is not an acceptable way to conceal sustained overload.

## Offline release consistency and supply chain

Studio's [`service worker`](../../studio/public/sw.js) uses a `notefall-studio-` cache prefix plus a content-derived 16-hex-digit release version. Installation fetches the complete immutable precache with `cache: "reload"`; activation deletes only older NoteFall caches. Navigation and hashed assets are served from the same versioned cache, while dynamic same-origin requests and byte-range requests are not replayed from a stale runtime cache. This prevents an old HTML shell from being mixed with new JavaScript chunks during an update.

The [`distribution verifier`](../../web/scripts/verify-studio-dist.mjs) checks the generated asset manifest's byte lengths and SHA-256 values, the injected cache version, precache completeness, cache scoping, and the absence of unscoped cache lookup. The [`offline PWA smoke test`](../../web/scripts/pwa-offline-smoke.mjs) installs and activates the worker in a real browser, reloads while offline, checks asset lengths and version continuity, and exercises offline MSCX conversion under the production content-security policy.

Dependency inputs are reviewable: JavaScript installs use lockfiles, Python engineering dependencies are version pinned, GitHub Actions references use immutable commit SHAs, [dependency review](../../.github/workflows/dependency-review.yml) rejects newly introduced moderate-or-higher vulnerabilities on pull requests, and [Dependabot](../../.github/dependabot.yml) checks Actions, both npm workspaces, and Python dependencies weekly. This controls reproducibility and stale dependency risk; it does not replace artifact signing, upstream provenance review, or timely remediation.

## Numeric gates

| Area | Automated or design gate | Physical acceptance boundary |
|---|---:|---:|
| Responsive layouts | 390 x 844, 1280 x 900, 1600 x 1068, and 3200 x 2136 in Chromium and WebKit smoke coverage | repeat the landscape check at the tablet's default and daily display-size settings |
| HiDPI Canvas | DPR no greater than 2; backing area no greater than 7,500,000 pixels | sustained frame time, battery draw, and thermal throttling on the Xiaomi tablet |
| Web painting | expensive Canvas paint no faster than about 60 Hz; idle refresh 500 ms; sheet follow no faster than 80 ms | visual smoothness with representative long and dense personal scores |
| Dense score | simplified draw path above 160 visible notes | no dropped or misleading notes in stress repertoire |
| Native Android paint | minimum 15 ms between animated draws | measured frame-time distribution and lifecycle recovery on the installed tablet |
| Firmware queues | USB IN 128, USB OUT 128, browser 128, scheduled MIDI 256 | zero drops/resyncs in normal playing; depths and high-water marks return toward idle |
| Real-time task | Core 0, priority 7, 6144-byte stack, 5 ms idle poll | healthy heartbeat/watchdog and stable free-stack margin |
| LED SPI | 719 bytes at 8 MHz; theoretical wire time 0.719 ms | reported SPI last/max plus scope or logic-analyser confirmation if anomalous |
| Internal input-to-light path | instrumented maximum below 10 ms over at least 200 Note On/Off events | must be measured after real PX-S7000 USB enumeration |
| Visible end-to-end latency | test method: at least 20 samples in 120 fps video | median below 25 ms and P95 below 40 ms |
| Power and heat | calculated brightness/current and voltage-drop budgets remain in CI | 30-minute run below 55 °C and far-end voltage drop no greater than 0.25 V |
| Practice promotion | Wilson/confidence/coverage gates described above | user evaluation that recommendations remain musically useful across repertoire |

The repository reports the **latest automated suite** rather than freezing a test count in this document. The count changes as regression coverage grows; the meaningful claim is that the current CI, browser smoke tests, production builds, distribution verification, and applicable native/firmware builds pass together.

## What remains dependent on real hardware

Automation has established type safety, parser and state-machine behavior, protocol compatibility, bounded data structures, layout geometry, browser-rendered evidence, offline release integrity, Android debug packaging, and host-executed firmware core tests. It has not established the following physical facts:

- PX-S7000 USB enumeration, actual endpoint topology, bidirectional MIDI OUT behavior, CC88 behavior, and disconnect/reconnect recovery;
- measured callback-to-SPI and visible key-to-light latency on the target board and piano;
- all 88 calibrated key-to-pixel positions, including the two strip seams, and the seams' electrical reliability;
- far-end voltage, connector temperature, LED-strip temperature, brightness, glare, and optical visibility;
- key-travel clearance, removable adhesive behavior, and absence of cosmetic damage after removal;
- Xiaomi Pad 7 Ultra frame pacing, power use, hotspot/STA switching, lock-screen recovery, and long-session persistence; or
- signed iOS build, native lifecycle behavior, and distribution.

Until the corresponding steps in the [physical test procedure](testing.md) pass and their measurements are recorded, NoteFall 88 remains a digitally verified release candidate rather than a hardware-validated production release.
