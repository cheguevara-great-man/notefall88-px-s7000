# First build and non-destructive installation

## Before permanent attachment

Do not first glue the LED strip to the piano and hope software can repair a bad placement. The correct order is:

1. Bench-test the controller and all 176 LEDs at low brightness.
2. Temporarily place the strip on the piano with low-tack tape.
3. Align and calibrate it while it is still movable.
4. Verify full key travel and cable strain relief.
5. Make the final removable attachment, then repeat verification.

## Position and orientation

- The strip PCB is vertical (roughly 90 degrees to the key surface).
- LED faces point toward the player; their lower wide-angle light reaches the corresponding keys.
- Keep its lower edge about 2–3 mm above the natural white-key surface.
- Do not cover the red felt or let any part touch a moving black or white key.
- Do not use a full-length printed housing, diffuser, or black baffle in front of the LEDs. A thin black PET/PVC carrier is optional only to keep the strip straight and removable.

## Three-point placement anchors

For the measured purchased strip, count LEDs from the **physical left** (the two-wire end):

| Key | Target LED |
| --- | --- |
| A0, far left | 3rd LED |
| C4, middle C | 80th LED |
| C8, far right | 174th LED |

You do not need to count all LEDs by eye: the calibration UI has test buttons that illuminate these three anchors. The strip is centred across the 88-key span; a small PCB overhang at each end is expected. If all three anchors are displaced in the same direction, move the strip physically. Use a software global offset only for the remaining sub-pixel/one-pixel error.

The splice boundaries are near C2 and C#5. Check these areas especially carefully, but do not try to mechanically remove the gaps.

## Final attachment

First test the chosen removable mounting strip for 24 hours on an inconspicuous, non-key surface. Prefer a stretch-release removable mounting strip holding the optional carrier, rather than aggressive double-sided foam, hot glue, screws, or adhesive directly on the piano finish. If removal causes discoloration, stickiness, or unusual resistance, stop rather than prying.
