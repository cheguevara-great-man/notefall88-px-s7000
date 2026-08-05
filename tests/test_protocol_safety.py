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


def test_status_exposes_stable_reset_reason_for_power_fault_diagnosis() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "bootResetReason = esp_reset_reason()" in source
    assert 'doc["resetReason"] = resetReasonName(bootResetReason)' in source
    for reason in ("power-on", "software-reset", "panic", "watchdog", "brownout"):
        assert f'return "{reason}"' in source


def test_usb_input_latency_ends_after_immediate_spi_frame() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "uint64_t pendingLedInputUs" in source
    assert 'doc["ledInputLatencyAvgUs"]' in source
    assert 'doc["ledInputLatencyMaxUs"]' in source
    loop = source[source.index("void loop()") :]
    poll = loop.index("usbMidi.poll()")
    immediate = loop.index("if (pendingLedInputUs != 0)")
    browser_flush = loop.index("flushBrowserMidi()")
    network = loop.index("websocket.loop()")
    assert poll < immediate < browser_flush < network
    render = source[source.index("void renderStrip()") : source.index("void sendStatus")]
    assert render.index("strip.show") < render.index("ledInputLatencyLastUs = sample")


def test_browser_broadcast_cannot_delay_the_local_led_frame() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleMidiPacket") : source.index("void onPianoConnected")]
    assert "queueBrowserMidi" in handler
    assert "websocket.broadcastTXT" not in handler
    assert "kBrowserMidiCapacity = 64" in source
    assert 'doc["webMidiDropped"] = browserMidiDropped' in source
