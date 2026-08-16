from pathlib import Path
import re


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
    assert "sendAuthorizedText(payload, static_cast<size_t>(length))" in sender
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
    realtime = source[source.index("void serviceRealtimePipeline()") : source.index("void saveCalibration")]
    assert realtime.index("usbMidi.poll()") < realtime.index("renderStrip()")
    loop = source[source.index("void loop()") :]
    assert "flushBrowserMidi()" in loop and "websocket.loop()" in loop
    assert "usbMidi.poll()" not in loop
    render = source[source.index("bool renderStrip()") : source.index("void sendStatus")]
    assert render.index("strip.show") < render.index("ledInputLatency.observe(elapsed)")
    assert "xTaskCreatePinnedToCore(realtimeTask" in source
    assert "usbMidi.setConsumerTask(realtimeTaskHandle)" in source
    assert "kRealtimeTaskPriority = 7" in source


def test_browser_broadcast_cannot_delay_the_local_led_frame() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    handler = source[source.index("void handleMidiPacket") : source.index("void onPianoConnected")]
    assert "queueBrowserMidi" in handler
    assert "websocket.broadcastTXT" not in handler
    assert "kBrowserMidiCapacity = 128" in source
    assert "kBrowserMidiFlushBatch = 12" in source
    assert 'doc["webMidiDropped"] = webMidiDroppedSnapshot' in source
    assert "browserMidiResyncPending" in source


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
    assert '\\"v\\":%u' in source
    assert '\\"vh\\":%u' in source


def test_apa102_frame_is_bulk_transferred_and_idle_frames_are_skipped() -> None:
    source = (ROOT / "firmware" / "src" / "Apa102Strip.cpp").read_text(encoding="utf-8")
    assert "SPI.writeBytes(frame_" in source
    assert "SPI.transfer(" not in source
    assert "if (!dirty_ && !force)" in source
    assert "unchangedFramesSkipped" in source
    assert "apa102::controlByte(globalBrightness)" in source
    core = (ROOT / "firmware" / "include" / "apa102_core.h").read_text(encoding="utf-8")
    assert "static_assert(frameBytes(176) == 719)" in core
    assert "static_assert(controlByte(4) == 0xE4U)" in core
    main = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    for diagnostic in (
        "ledFrames", "ledFramesSkipped", "ledSpiLastUs", "ledSpiMaxUs", "ledFrameBytes"
    ):
        assert f'doc["{diagnostic}"]' in main


def test_usb_client_events_do_not_wait_behind_daemon_events() -> None:
    source = (ROOT / "firmware" / "src" / "UsbMidiHost.cpp").read_text(encoding="utf-8")
    client = source[source.index("void UsbMidiHost::hostTask") : source.index("void UsbMidiHost::daemonTask")]
    daemon = source[source.index("void UsbMidiHost::daemonTask") : source.index("void UsbMidiHost::clientEvent")]
    assert "usb_host_client_handle_events" in client
    assert "pdMS_TO_TICKS(5)" in client
    assert "usb_host_lib_handle_events" not in client
    assert "usb_host_lib_handle_events" in daemon
    assert "esp_task_wdt_add(nullptr)" in client
    assert "esp_task_wdt_add(nullptr)" in daemon
    transfer = source[source.index("void UsbMidiHost::inputTransferComplete") : source.index("void UsbMidiHost::outputTransferComplete")]
    enqueue = source[source.index("bool UsbMidiHost::enqueueInput") : source.index("bool UsbMidiHost::dequeueInput")]
    assert "host->notifyConsumer()" in transfer
    assert transfer.index("for (int offset") < transfer.index("host->notifyConsumer()")
    assert "notifyConsumer()" not in enqueue


def test_usb_disconnect_requests_immediate_blackout_and_output_reset() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    disconnected = source[source.index("void onPianoDisconnected") : source.index("void serviceRealtimePipeline")]
    assert "note.pressed = false" in disconnected
    assert "note.target = false" in disconnected
    assert "testNote = -1" in disconnected
    assert "outputResetRequested.store(true)" in disconnected
    assert "notifyRealtime()" in disconnected


def test_browser_overflow_resync_clears_all_pedals_and_notes() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    snapshot = source[source.index("void sendMidiStateSnapshot") : source.index("void flushBrowserMidi")]
    assert "channel = 1; channel <= 16" in snapshot
    for controller in (64, 66, 67, 123):
        assert f"sendMidiControl(channel, {controller}, 0, now)" in snapshot


def test_cross_core_state_uses_atomic_publication_or_fixed_queue_locks() -> None:
    host = (ROOT / "firmware" / "src" / "UsbMidiHost.h").read_text(encoding="utf-8")
    main = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    assert "std::atomic<bool> connected_" in host
    assert "std::atomic<uint8_t> outputEndpointAddress_" in host
    assert "std::atomic<TaskHandle_t> consumerTask_" in host
    browser = main[main.index("void queueBrowserMidi") : main.index("void handleMidiPacket")]
    assert "portENTER_CRITICAL(&browserMidiMux)" in browser
    assert "browserMidiEvents.push(event)" in browser
    assert "browserMidiEvents.pop(event)" in browser
    render = main[main.index("bool renderStrip()") : main.index("void sendStatus")]
    assert "portENTER_CRITICAL(&ledStateMux)" in render
    assert "std::memcpy(snapshot, notes" in render


def test_status_diagnostics_remain_within_a_small_websocket_frame_budget() -> None:
    source = (ROOT / "firmware" / "src" / "main.cpp").read_text(encoding="utf-8")
    status = source[source.index("void sendStatus") : source.index("void sendCalibration")]
    keys = re.findall(r'doc\["([^"]+)"\]', status)
    assert len(keys) <= 80
    # Every numeric value fits in 20 ASCII digits. Add a conservative escaped
    # 256-byte USB error and token/string allowance; the actual status is much
    # smaller than this static upper bound.
    conservative_bytes = 2 + sum(len(key) + 5 + 20 for key in keys) + 256
    assert conservative_bytes < 4096


def test_usb_interface_selection_uses_the_native_executed_descriptor_core() -> None:
    source = (ROOT / "firmware" / "src" / "UsbMidiHost.cpp").read_text(encoding="utf-8")
    assert '#include "usb_midi_descriptor.h"' in source
    assert "usb::findMidiStreamingInterface(bytes, total, searchOffset, candidate)" in source
    assert "candidate.nextSearchOffset" in source
    assert "malformed USB configuration descriptor" in source
    assert "USB_B_DESCRIPTOR_TYPE_INTERFACE" not in source
