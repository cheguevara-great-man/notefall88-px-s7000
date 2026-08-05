import csv
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_harness() -> list[dict[str, str]]:
    with (ROOT / "docs" / "harness.csv").open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_harness_has_keyed_input_and_separate_far_end_injection():
    rows = read_harness()
    input_pins = {
        row["引脚"]: (row["颜色"], row["线径"])
        for row in rows
        if row["线束ID"] == "H1"
    }
    assert input_pins == {
        "Pin1 +5V": ("红", "20AWG"),
        "Pin2 GND": ("黑", "20AWG"),
        "Pin3 DATA": ("绿", "26AWG"),
        "Pin4 CLOCK": ("蓝", "26AWG"),
    }
    far_end = [row for row in rows if row["线束ID"] == "H4"]
    assert {row["引脚"] for row in far_end} == {"+5V", "GND"}


def test_all_power_conductors_are_at_least_24_awg_and_fused():
    rows = read_harness()
    for row in rows:
        if "+5V" in row["引脚"] or row["引脚"] == "USB VBUS":
            gauge = int(row["线径"].split("AWG")[0])
            assert gauge <= 24
    fuse_rows = [row for row in rows if row["线束ID"] == "H0"]
    assert any("3A保险丝" in row["终点"] for row in fuse_rows)


def test_wiring_svg_is_valid_and_names_every_harness_interface():
    svg = ROOT / "docs" / "wiring-harness.svg"
    ET.parse(svg)
    text = svg.read_text(encoding="utf-8")
    for label in (
        "3 A 保险丝",
        "Micro-Fit 4P",
        "XT30 2P",
        "USB/OTG口",
        "USB-to-UART 口供电",
        "双端注电",
    ):
        assert label in text
