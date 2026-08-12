# Hardware and wiring

## Confirmed baseline

- Loxin/LeXin ESP32-S3-DevKitC-1-N8R8.
- One 5 V, 144 LED/m, IP30 APA102C or SK9822 strip. The delivered strip has 176 LEDs and two factory solder splices.
- 74AHCT125 level-shifter module.
- Certified 5 V / 5 A supply, inline 3–5 A fuse, 1000 uF bulk capacitor at both power-injection ends, and 0.1 uF ceramic bypass capacitor at the level-shifter supply.
- USB-B to USB-A printer cable from piano to the powered OTG host path.
- Micro-Fit 4-pin locking LED input connector and XT30 remote power-injection connector.

## Signal path

`ESP32 GPIO -> 74AHCT125 -> 100 ohm series resistor -> strip DATA/CLOCK`

The LED strip receives its own 5 V and GND wiring. DATA, CLOCK and GND must share a common reference. Do not connect LED power through an ESP32 GPIO, USB data connector, or breadboard jumper.

## USB roles

The PX-S7000 is a USB MIDI peripheral. The ESP32-S3 native OTG port is the USB host. The OTG Y-cable exists to provide VBUS power to the piano-side USB device path; its third leg powers the USB peripheral side, not the ESP32 board itself. The board has its own 5 V supply connection.

The exact connector labeling on the purchased N8R8 board must be confirmed from its silk screen on arrival. Follow the build checklist rather than guessing from cable gender.

## Delivered strip orientation

In the user's strip photographs, the four-wire/data-input end is on the physical right and printed arrows point left. Place the two-wire end at the piano's left, keep the four-wire input at the right/controller side, and enable the firmware direction-reversal setting if the A0/C4/C8 test proves it is needed.

Never cut, stretch, fold, or re-solder the delivered strip to remove the two splice gaps.
