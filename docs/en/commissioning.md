# Commissioning and calibration

## Acceptance order

1. With the piano disconnected, inspect polarity, fuse, capacitance polarity, insulation, and strain relief.
2. Power the controller and run the low-brightness LED chase. Confirm every LED and both splice regions work.
3. Connect the piano through native USB host and confirm USB MIDI enumeration.
4. Press middle C on the piano and confirm a real MIDI Note On appears in diagnostics.
5. Temporarily mount the strip and run A0, C4, and C8 light tests.
6. Select strip direction, then set global offset. Physically reposition the strip if the gross alignment is wrong.
7. Use bounded individual-key correction only after three-point alignment is correct.
8. Test all 88 keys, both splice regions, pedals, Wi-Fi reconnect, USB reconnect, and safe-off behavior.

## Calibration rules

- Direction reversal handles a strip installed from the opposite data end.
- Global offset handles a uniform one-pixel placement residual.
- Per-key correction is intentionally limited to +/-4 pixels. It is for small mechanical tolerance, never for disguising a badly positioned strip.
- Calibration is saved in ESP32 NVS and survives a normal restart.

## Pass criteria

- Every target key lights its intended local key area.
- No two piano keys share a primary LED.
- No LED, solder joint, carrier, or cable contacts a key during a full-travel press.
- A USB loss, target timeout, invalid command, or reboot turns target lights off.
- The controller remains cool and the power supply/fuse wiring show no abnormal behavior.
