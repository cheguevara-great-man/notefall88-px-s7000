import csv
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "docs" / "deploy"


def read_inventory() -> list[dict[str, str]]:
    with (DEPLOY / "as-purchased.csv").open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_as_purchased_inventory_records_the_real_build_overlay() -> None:
    rows = read_inventory()
    by_item = {row["物料"]: row for row in rows}
    for item in (
        "ESP32-S3-DevKitC-1",
        "供电型OTG Y线",
        "SK9822灯带",
        "74AHCT125N",
        "KF301-2P共点端子",
        "KF301-3P共点端子",
        "Micro-USB公头供电线",
    ):
        assert item in by_item
    assert by_item["ESP32-S3-DevKitC-1"]["已购数量或规格"] == "乐鑫官方 N8R8"
    assert by_item["74AHCT125N"]["处置"].startswith("只在面包板完成G1")
    assert "商家已确认所购具体款可以共点" in by_item["KF301-2P共点端子"]["到货必须确认"]
    assert "每个节点必须实测记录" in by_item["KF301-3P共点端子"]["处置"]


def test_bare_level_shifter_has_decoupling_and_permanent_build_gate() -> None:
    inventory = (DEPLOY / "as-purchased.csv").read_text(encoding="utf-8")
    checklist = (DEPLOY / "arrival-checklist.md").read_text(encoding="utf-8")
    assert "0.1uF陶瓷去耦电容" in inventory
    assert "待补必需" in inventory
    assert "0.1 µF（100 nF）陶瓷电容：必需" in checklist
    assert "裸 DIP 芯片直接装入最终控制盒" in checklist


def test_kf301_vendor_claim_requires_physical_continuity_evidence() -> None:
    documents = [
        DEPLOY / "q-and-a.md",
        DEPLOY / "vendor-manufacturing.md",
        DEPLOY / "arrival-checklist.md",
    ]
    forbidden = "用 1 个 2 线 + 1 个 3 线拼成 5 孔"
    for path in documents:
        text = path.read_text(encoding="utf-8")
        assert forbidden not in text
        assert "KF301" in text
    checklist = documents[-1].read_text(encoding="utf-8")
    assert "商家已经确认" in checklist
    assert "哪些孔互通" in checklist
    assert "5V 组与 GND 组必须完全不通" in checklist


def test_public_deployment_docs_do_not_contain_personal_identifiers() -> None:
    patterns = {
        "phone": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
        "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
        "id_card": re.compile(r"(?<!\d)\d{17}[0-9Xx](?!\d)"),
        "transaction": re.compile(r"(?:订单|运单|快递|物流)[号：:\s]+[A-Za-z0-9-]{8,}"),
    }
    findings: list[str] = []
    for path in sorted(DEPLOY.iterdir()):
        if path.suffix not in {".md", ".csv"}:
            continue
        text = path.read_text(encoding="utf-8")
        for label, pattern in patterns.items():
            if pattern.search(text):
                findings.append(f"{path.name}: {label}")
    assert findings == []


def test_arrival_gate_preserves_usb_power_topology_and_no_power_before_audit() -> None:
    checklist = (DEPLOY / "arrival-checklist.md").read_text(encoding="utf-8")
    inventory = (DEPLOY / "as-purchased.csv").read_text(encoding="utf-8")
    for invariant in ("H5", "H7", "VBUS", "GND", "不得给灯带或钢琴 USB 链路上电"):
        assert invariant in checklist or invariant in inventory
    assert "共点关系未记录前不得上电" in inventory
