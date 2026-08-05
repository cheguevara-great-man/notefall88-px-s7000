import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _number(value: str) -> int:
    return int(value.strip(), 0)


def test_dual_ota_and_filesystem_partitions_are_non_overlapping() -> None:
    rows = []
    with (ROOT / "firmware" / "partitions.csv").open(encoding="utf-8") as handle:
        for raw in csv.reader(line for line in handle if not line.lstrip().startswith("#")):
            if not raw:
                continue
            name, kind, subtype, offset, size, *_ = [value.strip() for value in raw]
            rows.append({"name": name, "kind": kind, "subtype": subtype, "offset": _number(offset), "size": _number(size)})

    by_name = {row["name"]: row for row in rows}
    assert by_name["app0"]["subtype"] == "ota_0"
    assert by_name["app1"]["subtype"] == "ota_1"
    assert by_name["app0"]["size"] == by_name["app1"]["size"] >= 0x280000
    assert by_name["littlefs"]["size"] >= 0x2E0000

    ordered = sorted(rows, key=lambda row: row["offset"])
    for first, second in zip(ordered, ordered[1:]):
        assert first["offset"] + first["size"] <= second["offset"], (first, second)
    assert max(row["offset"] + row["size"] for row in rows) <= 0x800000


def test_web_update_route_requires_hotspot_and_password() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    authorization = source[source.index("bool updateRequestAuthorized()") : source.index("void sendUpdateInfo()")]
    assert "requestUsesAccessPoint()" in authorization
    assert "kUpdateAuthHeader" in authorization
    assert "constantTimeEquals" in authorization
    assert 'http.on("/api/update", HTTP_POST' in source
    assert 'http.on("/api/wifi", HTTP_POST, saveStationWifi)' in source
    wifi = source[source.index("void saveStationWifi()") : source.index("void startNetwork()")]
    assert "updateRequestAuthorized()" in wifi
    assert "ssid.length() > 32" in wifi
    assert "panicMidiOutput();" in source[source.index("void handleUpdateUpload()") : source.index("void finishUpdateRequest()")]
