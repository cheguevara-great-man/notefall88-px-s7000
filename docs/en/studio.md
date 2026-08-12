# NoteFall Studio

Studio is the feature-rich practice layer. It is delivered as an installable PWA and as Capacitor-based Android/iOS packages so the same practice engine can be used in a browser, on a tablet, or in an app shell.

## Music and views

- MIDI and MusicXML/MXL import, with offline conversion support for common score formats.
- Piano-roll view, notation view, and a combined view; either visualization can be used alone.
- Responsive landscape layout designed for a 3:2 large tablet, including Xiaomi Pad 7 Ultra (3200 x 2136).
- Full-screen practice mode that removes nonessential chrome.

## Practice engine

- Real-time, Wait for Me, and Follow Me modes.
- Hand/part selection, A-B looping, tempo steps, transpose, count-in, metronome, and MIDI demonstration playback.
- Pitch, timing, velocity, duration, pedal, chord synchronization, and cross-hand analysis where the source score provides enough evidence.
- Recording to standard MIDI, session replay, local history, exports, adaptive weak-passage drills, and a spaced-review "Today" queue.

## Offline and privacy

Scores, recordings, analysis, and backups remain on the user's device unless explicitly exported. The ESP32 does not host the large Studio application; it hosts the lightweight control/recovery experience while Studio is installed or cached on the tablet/phone/computer.
