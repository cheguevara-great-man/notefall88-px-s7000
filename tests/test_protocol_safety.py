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


def test_station_clients_require_password_before_any_control_mutation() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleWebMessage") : source.index("bool websocketClientUsesAccessPoint")]
    hello = handler.index('strcmp(type, "hello")')
    auth = handler.index("if (!webControlAuthorized[client])")
    mutation = handler.index('strcmp(type, "target")')
    assert hello < auth < mutation
    assert "notefall::security::controlAuthorized" in handler
    assert "constantTimeEquals(String(suppliedAuth), activeApPassword)" in handler
    assert "constantTimeEquals(String(suppliedToken), controlSessionToken)" in handler
    assert "++webAuthRejected" in handler
    policy = (ROOT / "firmware" / "include" / "control_policy.h").read_text(encoding="utf-8")
    assert "static_assert(!automaticAccessPointTrust(true, true))" in policy
    assert "static_assert(!controlAuthorized(false, true, true, true))" in policy
    assert "static_assert(!controlAuthorized(true, false, false, false))" in policy
    assert "static_assert(!controlAuthorized(true, false, true, false))" in policy


def test_piano_events_and_calibration_only_reach_authorized_clients() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    sender = source[source.index("void sendCalibration") : source.index("void queueBrowserMidi")]
    assert "webControlAuthorized[index]" in sender
    assert "sendAuthorizedText(payload)" in sender
    assert "websocket.broadcastTXT(payload)" not in sender
    assert 'doc["controlAuthorized"]' in source
    assert 'doc["accessPointClient"]' in source
    assert 'doc["controlToken"] = controlSessionToken' in source
    assert "webControlAuthorized[client] && !webAccessPointClient[client]" in source


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


def test_ping_returns_the_device_clock_used_by_usb_midi_timestamps() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleWebMessage") : source.index("void webSocketEvent")]
    ping = handler[handler.index('strcmp(type, "ping")') : handler.index('strcmp(type, "target")')]
    assert 'reply["ts"] = doc["ts"] | 0' in ping
    assert 'reply["deviceTs"] = millis()' in ping
    midi = source[source.index("void handleMidiPacket") : source.index("void onPianoConnected")]
    assert "static_cast<uint32_t>(receivedUs / 1000U)" in midi


def test_output_mirror_heuristic_never_discards_real_keyboard_input() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleMidiPacket") : source.index("void onPianoConnected")]
    observer = source[source.index("void observeOutputMirrorCandidate") : source.index("bool scheduleMidiMessage")]
    assert "observeOutputMirrorCandidate(status, firstData, secondData" in handler
    assert "consumeOutputEcho" not in source
    assert "return true" not in observer
    assert 'doc["usbOutputMirrorCandidates"]' in source


def test_high_resolution_velocity_prefix_is_channel_scoped_and_backward_compatible() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleMidiPacket") : source.index("void onPianoConnected")]
    assert "notefall::midi::HighResolutionVelocityTracker velocityTracker" in source
    assert "velocityTracker.observeControl(channel, firstData, secondData)" in handler
    assert "velocityTracker.consumeForNote(channel, secondData)" in handler
    assert "velocityTracker.clear()" in source
    assert "pendingVelocityLsb" not in source
    assert 'doc["v"] = velocity' in source
    assert 'doc["vh"] = highResolutionVelocity' in source


def test_usb_interface_selection_uses_the_native_executed_descriptor_core() -> None:
    source = (ROOT / "firmware" / "src" / "UsbMidiHost.cpp").read_text(encoding="utf-8")
    assert '#include "usb_midi_descriptor.h"' in source
    assert "usb::findMidiStreamingInterface(bytes, total, searchOffset, candidate)" in source
    assert "candidate.nextSearchOffset" in source
    assert "malformed USB configuration descriptor" in source
    assert "USB_B_DESCRIPTOR_TYPE_INTERFACE" not in source
