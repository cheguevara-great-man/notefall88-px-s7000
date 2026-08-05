from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_websocket_mutations_require_matching_protocol_handshake() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleWebMessage") : source.index("void webSocketEvent")]
    hello = handler.index('strcmp(type, "hello")')
    mutation = handler.index('strcmp(type, "target")')
    guard = handler.index("if (!webProtocolCompatible[client])")
    assert hello < guard < mutation
    assert "received == kProtocolVersion" in handler
    assert 'reply["t"] = "protocolError"' in handler


def test_websocket_rejects_oversized_or_invalid_json_before_mutation() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleWebMessage") : source.index("void webSocketEvent")]
    assert "length > kMaxWebMessageBytes" in handler
    assert handler.index("length > kMaxWebMessageBytes") < handler.index("deserializeJson")
    assert "++webMessagesRejected" in handler


def test_stored_per_key_calibration_is_bounded_before_use() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    setup = source[source.index("void setup()") : source.index("void loop()")]
    load = setup.index('preferences.getBytes("keyOffsets"')
    clamp = setup.index("clampValue<int>(offset, -kMaxKeyPixelOffset, kMaxKeyPixelOffset)")
    strip_start = setup.index("strip.begin()")
    assert load < clamp < strip_start
    assert 'doc["nvsReady"] = preferencesReady' in source
