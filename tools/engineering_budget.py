"""Print deterministic V0/full-width timing, power, and bandwidth budgets."""

from __future__ import annotations

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def calculate() -> dict[str, object]:
    cfg = json.loads((ROOT / "config" / "system.json").read_text(encoding="utf-8"))
    led = cfg["led"]
    proto = cfg["protocol"]
    prototype = cfg["prototype"]
    pitch_mm = 1000.0 / led["pixels_per_m"]
    v0_pixels = led["pixels_per_row"] * prototype["row_count"]
    full_row_pixels = math.ceil(1225.0 / pitch_mm)
    full_pixels = full_row_pixels * prototype["row_count"]
    watts_per_pixel_conservative = 0.30
    brightness_fraction = led["max_global_brightness"] / 31.0
    spi_end_bytes = max(4, math.ceil(full_pixels / 16))
    spi_frame_bytes = 4 + 4 * full_pixels + spi_end_bytes
    serial_payload_bytes = 4 + 4 * 88 * 3
    serial_wire_bytes = serial_payload_bytes + 10  # 8-byte header + 2-byte CRC
    return {
        "assumptions": {
            "full_keybed_width_mm": 1225.0,
            "watts_per_pixel_full_white": watts_per_pixel_conservative,
            "uart_format": "8N1",
        },
        "v0": {
            "pixels": v0_pixels,
            "full_white_worst_case_w": round(v0_pixels * watts_per_pixel_conservative, 2),
            "estimated_at_brightness_cap_w": round(v0_pixels * watts_per_pixel_conservative * brightness_fraction, 2),
        },
        "full88_estimate": {
            "pixels_per_row": full_row_pixels,
            "pixels": full_pixels,
            "full_white_worst_case_w": round(full_pixels * watts_per_pixel_conservative, 2),
            "estimated_at_brightness_cap_w": round(full_pixels * watts_per_pixel_conservative * brightness_fraction, 2),
            "spi_frame_ms": round(spi_frame_bytes * 8 / led["spi_hz"] * 1000, 3),
            "serial_kbytes_per_s": round(serial_wire_bytes * proto["frame_hz"] / 1000, 2),
            "uart_8n1_capacity_kbytes_per_s": round(proto["baud"] / 10 / 1000, 2),
        },
    }


def main() -> None:
    print(json.dumps(calculate(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

