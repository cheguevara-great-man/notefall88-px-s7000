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

    firmware = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert 'kLittleFsPartitionLabel[] = "littlefs"' in firmware
    assert 'LittleFS.begin(true, "/littlefs", 10, kLittleFsPartitionLabel)' in firmware
    assert 'LittleFS.begin(false, "/littlefs", 10, kLittleFsPartitionLabel)' in firmware

    ordered = sorted(rows, key=lambda row: row["offset"])
    for first, second in zip(ordered, ordered[1:]):
        assert first["offset"] + first["size"] <= second["offset"], (first, second)
    assert max(row["offset"] + row["size"] for row in rows) <= 0x800000


def test_web_update_route_requires_password_and_remains_available_on_lan_or_hotspot() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    authorization = source[source.index("bool updateRequestAuthorized()") : source.index("void sendUpdateInfo()")]
    assert "kUpdateAuthHeader" in authorization
    assert "constantTimeEquals" in authorization
    assert "requestUsesAccessPoint()" not in authorization
    assert 'http.on("/api/update", HTTP_POST' in source
    assert 'http.on("/api/wifi", HTTP_POST, saveStationWifi)' in source
    assert 'http.on("/api/restart", HTTP_POST' in source
    wifi = source[source.index("void saveStationWifi()") : source.index("void startNetwork()")]
    assert "updateRequestAuthorized()" in wifi
    assert "ssid.length() > 32" in wifi
    assert "panicMidiOutput();" in source[source.index("void handleUpdateUpload()") : source.index("void finishUpdateRequest()")]


def test_new_ota_image_requires_internal_and_external_health_before_confirmation() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert 'extern "C" bool verifyRollbackLater() { return true; }' in source
    validation = source[
        source.index("void beginOtaBootVerification") : source.index("}  // namespace")
    ]
    assert "ESP_OTA_IMG_PENDING_VERIFY" in validation
    assert "otaExternalHealthSeen && otaInternalHealthReady()" in validation
    assert "esp_ota_mark_app_valid_cancel_rollback()" in validation
    assert "esp_ota_mark_app_invalid_rollback_and_reboot()" in validation
    assert "kOtaConfirmationDeadlineMs" in validation


def test_recovery_ui_and_station_reconnect_are_compiled_into_every_firmware() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "constexpr char kRecoveryPage[] PROGMEM" in source
    assert 'http.on("/recovery", HTTP_GET' in source
    assert 'http.sendHeader("Location", "/recovery", true)' in source
    network = source[source.index("void startNetwork()") : source.index("void beginOtaBootVerification")]
    assert "WiFi.setAutoReconnect(true)" in network
    assert "WiFi.setSleep(false)" in network
    assert "WiFi.reconnect()" in network
    assert "configuredStationSsid" in network
    assert 'std::strcmp(request, "NOTEFALL_DISCOVER_V1")' in source
    assert "discoveryUdp.begin(kDiscoveryPort)" in source
    assert "serviceDiscovery();" in source
