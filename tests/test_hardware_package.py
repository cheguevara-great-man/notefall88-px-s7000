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
        "H7 → OTG Y 线第3供电口",
        "双端注电",
    ):
        assert label in text


def test_optical_installation_svg_locks_exposed_vertical_strip_geometry():
    svg = ROOT / "docs" / "optical-installation.svg"
    ET.parse(svg)
    text = svg.read_text(encoding="utf-8")
    for invariant in (
        "固定黑色立面（不是打印件）",
        "12 mm 黑色 PCB 灯带",
        "名义 2.5 mm",
        "发光主方向朝演奏者",
        "无贯穿全长的 3D 打印盒",
        "不得碰白键或黑键",
    ):
        assert invariant in text


def test_usb_host_and_device_vbus_use_distinct_fused_branches():
    rows = read_harness()
    h5 = [row for row in rows if row["线束ID"] == "H5"]
    h7 = [row for row in rows if row["线束ID"] == "H7"]
    assert len(h5) == 2
    assert len(h7) == 2
    assert {row["终点"] for row in h5} == {"ESP32的USB-to-UART口"}
    assert {row["终点"] for row in h7} == {"OTG Y线第3供电口"}
    assert all(row["起点"] in {"3A保险丝输出", "公共地母排"} for row in h5 + h7)

    decision = (ROOT / "docs" / "decisions" / "001-native-usb-host-and-vbus.md").read_text(
        encoding="utf-8"
    )
    for invariant in ("不增加 MAX3421E", "H5", "H7", "不给 ESP32 反向供电", "不得只给"):
        assert invariant in decision


def test_usb_y_cable_role_is_consistent_across_handoff_documents():
    documents = [
        ROOT / "README.md",
        ROOT / "docs" / "hardware.md",
        ROOT / "docs" / "first-build.md",
        ROOT / "docs" / "testing.md",
        ROOT / "docs" / "decisions" / "001-native-usb-host-and-vbus.md",
    ]
    for path in documents:
        text = path.read_text(encoding="utf-8")
        for invariant in ("H5", "H7", "USB"):
            assert invariant in text, f"{path.name} lost the two-branch USB power topology"
    decision = documents[-1].read_text(encoding="utf-8")
    assert "不增加 MAX3421E" in decision
    assert "Y 线只做插头转换和 VBUS 注入，不提供 Host 协议能力" in decision
    assert "不得只给 ESP32 的 UART 口供电并把 Y 线第三口留空" in decision


def test_firmware_environment_targets_n8r8_opi_psram():
    platformio = (ROOT / "firmware" / "platformio.ini").read_text(encoding="utf-8")
    for setting in (
        "default_envs = esp32-s3-devkitc-1-n8r8",
        "board_build.arduino.memory_type = qio_opi",
        "board_build.psram_type = opi",
        "board_upload.flash_size = 8MB",
        "-D BOARD_HAS_PSRAM",
    ):
        assert setting in platformio
