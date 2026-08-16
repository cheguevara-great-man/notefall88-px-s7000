#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <Update.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/task.h>

#include "Apa102Strip.h"
#include "UsbMidiHost.h"
#include "app_config.h"
#include "control_policy.h"
#include "layout_generated.h"
#include "midi_core.h"
#include "realtime_core.h"

namespace {

using notefall::Apa102Strip;
using notefall::Rgb;
using namespace notefall::app;
using namespace notefall::layout;

struct NoteState {
  bool target = false;
  bool pressed = false;
  uint8_t hand = 1;
  uint8_t velocity = 0;
};

struct ScheduledMidiMessage {
  uint32_t dueMs = 0;
  uint8_t status = 0;
  uint8_t data1 = 0;
  uint8_t data2 = 0;
};

struct OutputMirrorProbe {
  uint32_t expiresMs = 0;
  uint8_t status = 0;
  uint8_t data1 = 0;
  uint8_t data2 = 0;
};

struct WebUpdateState {
  bool authorized = false;
  bool started = false;
  bool success = false;
  bool filesystemUnmounted = false;
  size_t written = 0;
  String error;
};

enum class BrowserMidiKind : uint8_t { Note, Control };

struct BrowserMidiEvent {
  BrowserMidiKind kind = BrowserMidiKind::Note;
  bool on = false;
  uint8_t channel = 1;
  uint8_t firstData = 0;
  uint8_t secondData = 0;
  uint16_t highResolutionVelocity = 0;
  bool hasHighResolutionVelocity = false;
  uint32_t timestampMs = 0;
};

Apa102Strip strip(kPixelCount, kDataPin, kClockPin, kSpiHz);
notefall::UsbMidiHost usbMidi;
WebServer http(kHttpPort);
WebSocketsServer websocket(kWebSocketPort);
Preferences preferences;
NoteState notes[kNoteCount];
notefall::midi::HighResolutionVelocityTracker velocityTracker;

std::atomic<bool> pianoConnected{false};
bool mdnsStarted = false;
bool restartRequested = false;
bool preferencesReady = false;
uint8_t previousApStationCount = 0;
esp_reset_reason_t bootResetReason = ESP_RST_UNKNOWN;
uint8_t webClients = 0;
uint8_t brightness = kDefaultGlobalBrightness;
int8_t pixelOffset = 0;
int8_t keyPixelOffsets[kNoteCount]{};
bool stripReversed = false;
uint32_t lastTargetMs = 0;
uint32_t lastStatusMs = 0;
int16_t testNote = -1;
uint32_t testUntilMs = 0;
constexpr size_t kScheduledMidiCapacity = 256;
constexpr size_t kOutputMirrorProbeCapacity = 48;
constexpr size_t kBrowserMidiCapacity = 128;
constexpr char kLittleFsPartitionLabel[] = "littlefs";
ScheduledMidiMessage scheduledMidi[kScheduledMidiCapacity]{};
size_t scheduledMidiCount = 0;
OutputMirrorProbe outputMirrorProbes[kOutputMirrorProbeCapacity]{};
size_t nextOutputMirrorProbe = 0;
uint32_t midiScheduleDropped = 0;
uint32_t midiOutputMirrorCandidates = 0;
int16_t midiOutOwner = -1;
static_assert(WEBSOCKETS_SERVER_CLIENT_MAX <= 255, "WebSocket client id must fit uint8_t");
bool webProtocolCompatible[WEBSOCKETS_SERVER_CLIENT_MAX]{};
bool webControlAuthorized[WEBSOCKETS_SERVER_CLIENT_MAX]{};
bool webAccessPointClient[WEBSOCKETS_SERVER_CLIENT_MAX]{};
uint32_t webMessagesRejected = 0;
uint32_t webAuthRejected = 0;
notefall::realtime::FixedQueue<BrowserMidiEvent, kBrowserMidiCapacity> browserMidiEvents;
uint32_t browserMidiDropped = 0;
uint32_t browserMidiResyncs = 0;
uint16_t browserMidiQueueHighWater = 0;
bool browserMidiResyncPending = false;
uint64_t pendingLedInputUs = 0;
notefall::realtime::LatencyAccumulator ledInputLatency;
notefall::realtime::LatencyAccumulator midiDispatchLatency;
portMUX_TYPE ledStateMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE browserMidiMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE realtimeMetricsMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE outputMirrorMux = portMUX_INITIALIZER_UNLOCKED;
TaskHandle_t realtimeTaskHandle = nullptr;
bool ledDirty = true;
std::atomic<bool> realtimeTaskReady{false};
std::atomic<bool> realtimeWatchdogArmed{false};
std::atomic<bool> outputResetRequested{false};
std::atomic<bool> statusBroadcastRequested{false};
std::atomic<uint32_t> realtimeHeartbeatMs{0};
std::atomic<uint32_t> realtimeWakeups{0};
std::atomic<uint32_t> ledRenderGeneration{0};
uint32_t mainLoopLastUs = 0;
uint32_t mainLoopMaxUs = 0;
String activeApPassword;
String controlSessionToken;
WebUpdateState webUpdate;

constexpr Rgb kLeftTarget{28, 178, 255};
constexpr Rgb kRightTarget{255, 42, 175};
constexpr Rgb kCorrect{35, 255, 104};
constexpr Rgb kWrong{255, 55, 28};
constexpr Rgb kTest{255, 210, 32};
constexpr int8_t kMaxKeyPixelOffset = 4;
constexpr uint32_t kMaxMidiScheduleDelayMs = 60000;
constexpr uint32_t kOutputMirrorProbeMs = 80;
constexpr size_t kMaxWebMessageBytes = 8192;
constexpr size_t kBrowserMidiFlushBatch = 12;
constexpr uint32_t kRealtimeIdlePollMs = 5;
constexpr uint32_t kRealtimeTaskStackBytes = 6144;
constexpr UBaseType_t kRealtimeTaskPriority = 7;
constexpr char kUpdateAuthHeader[] = "X-NoteFall-Admin";

template <typename T>
T clampValue(T value, T low, T high) {
  return value < low ? low : (value > high ? high : value);
}

const char* resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_EXT: return "external-reset";
    case ESP_RST_SW: return "software-reset";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt-watchdog";
    case ESP_RST_TASK_WDT: return "task-watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep-sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}

String generateControlSessionToken() {
  char encoded[33]{};
  for (size_t word = 0; word < 4; ++word) {
    snprintf(encoded + word * 8, 9, "%08lx", static_cast<unsigned long>(esp_random()));
  }
  return String(encoded);
}

bool validNote(int note) { return note >= kFirstMidiNote && note <= kLastMidiNote; }

bool constantTimeEquals(const String& first, const String& second) {
  const size_t maximum = std::max(first.length(), second.length());
  uint8_t difference = static_cast<uint8_t>(first.length() ^ second.length());
  for (size_t index = 0; index < maximum; ++index) {
    const char a = index < first.length() ? first[index] : 0;
    const char b = index < second.length() ? second[index] : 0;
    difference |= static_cast<uint8_t>(a ^ b);
  }
  return difference == 0;
}

size_t noteIndex(uint8_t note) { return static_cast<size_t>(note - kFirstMidiNote); }

bool timeReached(uint32_t now, uint32_t target) {
  return notefall::midi::timeReached(now, target);
}

bool validOutputMessage(uint8_t status, uint8_t data1, uint8_t data2) {
  if ((status & 0x80U) == 0 || data1 > 127 || data2 > 127) return false;
  const uint8_t command = status & 0xF0U;
  return command >= 0x80U && command <= 0xE0U;
}

void registerOutputMirrorProbe(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
  portENTER_CRITICAL(&outputMirrorMux);
  OutputMirrorProbe& probe = outputMirrorProbes[nextOutputMirrorProbe];
  probe.expiresMs = now + kOutputMirrorProbeMs;
  probe.status = status;
  probe.data1 = data1;
  probe.data2 = data2;
  nextOutputMirrorProbe = (nextOutputMirrorProbe + 1) % kOutputMirrorProbeCapacity;
  portEXIT_CRITICAL(&outputMirrorMux);
}

void observeOutputMirrorCandidate(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
  portENTER_CRITICAL(&outputMirrorMux);
  for (auto& probe : outputMirrorProbes) {
    if (probe.expiresMs == 0 || timeReached(now, probe.expiresMs)) {
      probe.expiresMs = 0;
      continue;
    }
    const bool exact = probe.status == status && probe.data1 == data1 && probe.data2 == data2;
    const bool probeIsOff = (probe.status & 0xF0U) == 0x80U ||
        ((probe.status & 0xF0U) == 0x90U && probe.data2 == 0);
    const bool messageIsOff = (status & 0xF0U) == 0x80U ||
        ((status & 0xF0U) == 0x90U && data2 == 0);
    const bool equivalentNoteOff = probeIsOff && messageIsOff &&
        (probe.status & 0x0FU) == (status & 0x0FU) && probe.data1 == data1;
    if (exact || equivalentNoteOff) {
      probe.expiresMs = 0;
      ++midiOutputMirrorCandidates;
      portEXIT_CRITICAL(&outputMirrorMux);
      return;
    }
  }
  portEXIT_CRITICAL(&outputMirrorMux);
}

bool scheduleMidiMessage(uint32_t dueMs, uint8_t status, uint8_t data1, uint8_t data2) {
  if (!validOutputMessage(status, data1, data2) || scheduledMidiCount >= kScheduledMidiCapacity) {
    ++midiScheduleDropped;
    return false;
  }
  ScheduledMidiMessage& message = scheduledMidi[scheduledMidiCount++];
  message.dueMs = dueMs;
  message.status = status;
  message.data1 = data1;
  message.data2 = data2;
  return true;
}

void panicMidiOutput() {
  scheduledMidiCount = 0;
  portENTER_CRITICAL(&outputMirrorMux);
  for (auto& probe : outputMirrorProbes) probe.expiresMs = 0;
  portEXIT_CRITICAL(&outputMirrorMux);
  usbMidi.panic();
}

void processScheduledMidi() {
  if (scheduledMidiCount == 0) return;
  if (!usbMidi.outputAvailable()) {
    midiScheduleDropped += scheduledMidiCount;
    scheduledMidiCount = 0;
    return;
  }
  const uint32_t now = millis();
  size_t retained = 0;
  const size_t originalCount = scheduledMidiCount;
  for (size_t index = 0; index < originalCount; ++index) {
    const ScheduledMidiMessage message = scheduledMidi[index];
    const bool due = timeReached(now, message.dueMs);
    const bool sent = due && usbMidi.sendMidiMessage(
        message.status, message.data1, message.data2);
    if (sent) {
      registerOutputMirrorProbe(message.status, message.data1, message.data2, now);
    } else {
      scheduledMidi[retained++] = message;
    }
  }
  scheduledMidiCount = retained;
}

void notifyRealtime() {
  const TaskHandle_t task = realtimeTaskHandle;
  if (task != nullptr) xTaskNotifyGive(task);
}

void clearTargets() {
  portENTER_CRITICAL(&ledStateMux);
  for (auto& note : notes) note.target = false;
  lastTargetMs = 0;
  ledDirty = true;
  portEXIT_CRITICAL(&ledStateMux);
  notifyRealtime();
}

bool renderStrip() {
  NoteState snapshot[kNoteCount];
  int8_t offsetSnapshot[kNoteCount];
  uint8_t brightnessSnapshot = 1;
  int8_t globalOffsetSnapshot = 0;
  int16_t testNoteSnapshot = -1;
  bool reversedSnapshot = false;
  const uint32_t now = millis();

  portENTER_CRITICAL(&ledStateMux);
  if (lastTargetMs != 0 && now - lastTargetMs > kTargetStaleMs) {
    for (auto& note : notes) note.target = false;
    lastTargetMs = 0;
    ledDirty = true;
  }
  if (testNote >= 0 && timeReached(now, testUntilMs)) {
    testNote = -1;
    ledDirty = true;
  }
  if (!ledDirty) {
    portEXIT_CRITICAL(&ledStateMux);
    return false;
  }
  ledDirty = false;
  std::memcpy(snapshot, notes, sizeof(snapshot));
  std::memcpy(offsetSnapshot, keyPixelOffsets, sizeof(offsetSnapshot));
  brightnessSnapshot = brightness;
  globalOffsetSnapshot = pixelOffset;
  testNoteSnapshot = testNote;
  reversedSnapshot = stripReversed;
  portEXIT_CRITICAL(&ledStateMux);

  strip.clear();
  for (uint8_t midiNote = kFirstMidiNote; midiNote <= kLastMidiNote; ++midiNote) {
    const size_t index = noteIndex(midiNote);
    const int pixel = notefall::midi::mapPixel(
        midiNote, kFirstMidiNote, kLastMidiNote, kPixelCount, kPixelByNote,
        offsetSnapshot, globalOffsetSnapshot, reversedSnapshot);
    if (pixel < 0) continue;
    Rgb color{};
    if (snapshot[index].target) {
      color = snapshot[index].hand == 0 ? kLeftTarget : kRightTarget;
    }
    if (snapshot[index].pressed) color = snapshot[index].target ? kCorrect : kWrong;
    if (midiNote == testNoteSnapshot) color = kTest;
    strip.setPixel(static_cast<size_t>(pixel), color);
  }
  const bool transmitted = strip.show(
      std::min<uint8_t>(brightnessSnapshot, kMaxGlobalBrightness));
  if (pendingLedInputUs != 0) {
    const uint64_t elapsed = static_cast<uint64_t>(esp_timer_get_time()) - pendingLedInputUs;
    portENTER_CRITICAL(&realtimeMetricsMux);
    ledInputLatency.observe(elapsed);
    portEXIT_CRITICAL(&realtimeMetricsMux);
    pendingLedInputUs = 0;
  }
  ledRenderGeneration.fetch_add(1, std::memory_order_release);
  return transmitted;
}

void sendStatus(uint8_t client = 255) {
  if (client == 255) {
    for (uint8_t index = 0; index < WEBSOCKETS_SERVER_CLIENT_MAX; ++index) {
      if (websocket.clientIsConnected(index)) sendStatus(index);
    }
    return;
  }
  const auto usb = usbMidi.diagnostics();
  const auto led = strip.diagnostics();
  notefall::realtime::LatencySnapshot ledLatency;
  notefall::realtime::LatencySnapshot dispatchLatency;
  portENTER_CRITICAL(&realtimeMetricsMux);
  ledLatency = ledInputLatency.snapshot();
  dispatchLatency = midiDispatchLatency.snapshot();
  portEXIT_CRITICAL(&realtimeMetricsMux);
  uint32_t mirrorCandidates = 0;
  portENTER_CRITICAL(&outputMirrorMux);
  mirrorCandidates = midiOutputMirrorCandidates;
  portEXIT_CRITICAL(&outputMirrorMux);
  uint32_t webMidiDroppedSnapshot = 0;
  uint32_t webMidiResyncsSnapshot = 0;
  uint16_t webMidiDepth = 0;
  uint16_t webMidiHighWater = 0;
  portENTER_CRITICAL(&browserMidiMux);
  webMidiDroppedSnapshot = browserMidiDropped;
  webMidiResyncsSnapshot = browserMidiResyncs;
  webMidiDepth = static_cast<uint16_t>(browserMidiEvents.size());
  webMidiHighWater = browserMidiQueueHighWater;
  portEXIT_CRITICAL(&browserMidiMux);
  JsonDocument doc;
  doc["t"] = "status";
  doc["protocol"] = kProtocolVersion;
  doc["firmware"] = kFirmwareVersion;
  doc["controlSessionReady"] = webProtocolCompatible[client];
  doc["controlAuthorized"] = webControlAuthorized[client];
  doc["accessPointClient"] = webAccessPointClient[client];
  doc["defaultPassword"] = activeApPassword == kApPassword;
  if (webControlAuthorized[client] && !webAccessPointClient[client]) {
    doc["controlToken"] = controlSessionToken;
  }
  doc["piano"] = pianoConnected.load();
  doc["clients"] = webClients;
  doc["brightness"] = brightness;
  doc["offset"] = pixelOffset;
  doc["reversed"] = stripReversed;
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["uptimeMs"] = millis();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["psramBytes"] = ESP.getPsramSize();
  doc["freePsram"] = ESP.getFreePsram();
  doc["nvsReady"] = preferencesReady;
  doc["resetReason"] = resetReasonName(bootResetReason);
  doc["usbPackets"] = usb.packetsReceived;
  doc["usbDropped"] = usb.packetsDropped;
  doc["usbMalformed"] = usb.packetsMalformed;
  doc["usbErrors"] = usb.transferErrors;
  doc["usbLastError"] = usbMidi.lastError();
  doc["usbConnections"] = usb.connections;
  doc["usbLastPacketMs"] = usb.lastPacketMs;
  doc["usbVid"] = usb.vendorId;
  doc["usbPid"] = usb.productId;
  doc["usbEndpoint"] = usb.endpointAddress;
  doc["usbPacketSize"] = usb.endpointPacketSize;
  doc["usbOut"] = usbMidi.outputAvailable();
  doc["usbOutEndpoint"] = usb.outputEndpointAddress;
  doc["usbOutPacketSize"] = usb.outputEndpointPacketSize;
  doc["usbOutPackets"] = usb.packetsSent;
  doc["usbOutDropped"] = usb.outputPacketsDropped + midiScheduleDropped;
  doc["usbOutErrors"] = usb.outputTransferErrors;
  doc["usbOutQueued"] = scheduledMidiCount;
  doc["usbInputQueueDepth"] = usb.inputQueueDepth;
  doc["usbInputQueueHighWater"] = usb.inputQueueHighWater;
  doc["usbOutputQueueDepth"] = usb.outputQueueDepth;
  doc["usbOutputQueueHighWater"] = usb.outputQueueHighWater;
  doc["usbLargestInputBatch"] = usb.largestInputBatch;
  doc["usbInputResubmitRetries"] = usb.inputResubmitRetries;
  doc["usbClientWatchdog"] = usb.clientWatchdogArmed;
  doc["usbDaemonWatchdog"] = usb.daemonWatchdogArmed;
  doc["usbOutputMirrorCandidates"] = mirrorCandidates;
  doc["usbOutOwned"] = midiOutOwner >= 0;
  doc["webRejected"] = webMessagesRejected;
  doc["webAuthRejected"] = webAuthRejected;
  doc["webMidiDropped"] = webMidiDroppedSnapshot;
  doc["webMidiResyncs"] = webMidiResyncsSnapshot;
  doc["webMidiQueueDepth"] = webMidiDepth;
  doc["webMidiQueueHighWater"] = webMidiHighWater;
  doc["midiDispatchLatencyLastUs"] = dispatchLatency.lastUs;
  doc["midiDispatchLatencyAvgUs"] = dispatchLatency.averageUs;
  doc["midiDispatchLatencyMaxUs"] = dispatchLatency.maxUs;
  doc["midiDispatchLatencySamples"] = dispatchLatency.samples;
  doc["ledInputLatencyLastUs"] = ledLatency.lastUs;
  doc["ledInputLatencyAvgUs"] = ledLatency.averageUs;
  doc["ledInputLatencyMaxUs"] = ledLatency.maxUs;
  doc["ledInputLatencySamples"] = ledLatency.samples;
  doc["ledFrames"] = led.framesSent;
  doc["ledFramesSkipped"] = led.unchangedFramesSkipped;
  doc["ledSpiLastUs"] = led.lastTransferUs;
  doc["ledSpiMaxUs"] = led.maxTransferUs;
  doc["ledFrameBytes"] = led.frameBytes;
  doc["realtimeReady"] = realtimeTaskReady.load();
  doc["realtimeWatchdog"] = realtimeWatchdogArmed.load();
  doc["realtimeHeartbeatAgeMs"] = millis() - realtimeHeartbeatMs.load();
  doc["realtimeWakeups"] = realtimeWakeups.load();
  doc["realtimeStackFreeBytes"] = realtimeTaskHandle == nullptr
      ? 0
      : uxTaskGetStackHighWaterMark(realtimeTaskHandle);
  doc["mainLoopLastUs"] = mainLoopLastUs;
  doc["mainLoopMaxUs"] = mainLoopMaxUs;
  String payload;
  serializeJson(doc, payload);
  websocket.sendTXT(client, payload);
}

void sendCalibration(uint8_t client = 255) {
  JsonDocument doc;
  doc["t"] = "calibration";
  JsonArray offsets = doc["offsets"].to<JsonArray>();
  for (const int8_t offset : keyPixelOffsets) offsets.add(offset);
  String payload;
  serializeJson(doc, payload);
  if (client == 255) {
    for (uint8_t index = 0; index < WEBSOCKETS_SERVER_CLIENT_MAX; ++index) {
      if (websocket.clientIsConnected(index) && webControlAuthorized[index]) {
        websocket.sendTXT(index, payload);
      }
    }
  } else if (webControlAuthorized[client]) {
    websocket.sendTXT(client, payload);
  }
}

void sendAuthorizedText(const char* payload, size_t length) {
  for (uint8_t index = 0; index < WEBSOCKETS_SERVER_CLIENT_MAX; ++index) {
    if (websocket.clientIsConnected(index) && webControlAuthorized[index]) {
      websocket.sendTXT(index, reinterpret_cast<const uint8_t*>(payload), length);
    }
  }
}

void sendMidiEvent(bool on, uint8_t channel, uint8_t note, uint8_t velocity,
                   uint16_t highResolutionVelocity, bool hasHighResolutionVelocity,
                   uint32_t timestampMs) {
  char payload[128]{};
  const int length = hasHighResolutionVelocity
      ? std::snprintf(payload, sizeof(payload),
                      "{\"t\":\"midi\",\"s\":\"%s\",\"ch\":%u,\"n\":%u,\"v\":%u,\"vh\":%u,\"ts\":%lu}",
                      on ? "on" : "off", channel, note, velocity,
                      highResolutionVelocity, static_cast<unsigned long>(timestampMs))
      : std::snprintf(payload, sizeof(payload),
                      "{\"t\":\"midi\",\"s\":\"%s\",\"ch\":%u,\"n\":%u,\"v\":%u,\"ts\":%lu}",
                      on ? "on" : "off", channel, note, velocity,
                      static_cast<unsigned long>(timestampMs));
  if (length > 0 && static_cast<size_t>(length) < sizeof(payload)) {
    sendAuthorizedText(payload, static_cast<size_t>(length));
  }
}

void sendMidiControl(uint8_t channel, uint8_t controller, uint8_t value, uint32_t timestampMs) {
  char payload[112]{};
  const int length = std::snprintf(
      payload, sizeof(payload),
      "{\"t\":\"control\",\"ch\":%u,\"c\":%u,\"v\":%u,\"ts\":%lu}",
      channel, controller, value, static_cast<unsigned long>(timestampMs));
  if (length > 0 && static_cast<size_t>(length) < sizeof(payload)) {
    sendAuthorizedText(payload, static_cast<size_t>(length));
  }
}

void queueBrowserMidi(BrowserMidiKind kind, bool on, uint8_t channel,
                      uint8_t firstData, uint8_t secondData, uint32_t timestampMs,
                      uint16_t highResolutionVelocity = 0,
                      bool hasHighResolutionVelocity = false) {
  BrowserMidiEvent event;
  event.kind = kind;
  event.on = on;
  event.channel = channel;
  event.firstData = firstData;
  event.secondData = secondData;
  event.highResolutionVelocity = highResolutionVelocity;
  event.hasHighResolutionVelocity = hasHighResolutionVelocity;
  event.timestampMs = timestampMs;
  portENTER_CRITICAL(&browserMidiMux);
  if (!browserMidiEvents.push(event)) {
    ++browserMidiDropped;
    browserMidiResyncPending = true;
    portEXIT_CRITICAL(&browserMidiMux);
    return;
  }
  browserMidiQueueHighWater = std::max<uint16_t>(
      browserMidiQueueHighWater, static_cast<uint16_t>(browserMidiEvents.size()));
  portEXIT_CRITICAL(&browserMidiMux);
}

void sendMidiStateSnapshot() {
  bool pressed[kNoteCount]{};
  portENTER_CRITICAL(&ledStateMux);
  for (size_t index = 0; index < kNoteCount; ++index) pressed[index] = notes[index].pressed;
  portEXIT_CRITICAL(&ledStateMux);

  const uint32_t now = millis();
  // Stay within the existing protocol: All Notes Off followed by the currently
  // held keys reconstructs browser state even after queue overflow, without a
  // new message type that older Studio builds would ignore.
  for (uint8_t channel = 1; channel <= 16; ++channel) {
    // Clear pedal and note state on every channel before reconstructing held
    // keys. This also repairs a lost CC64/66/67 release, not just Note Off.
    sendMidiControl(channel, 64, 0, now);
    sendMidiControl(channel, 66, 0, now);
    sendMidiControl(channel, 67, 0, now);
    sendMidiControl(channel, 123, 0, now);
  }
  for (size_t index = 0; index < kNoteCount; ++index) {
    if (pressed[index]) {
      sendMidiEvent(true, 1, static_cast<uint8_t>(kFirstMidiNote + index), 64,
                    0, false, now);
    }
  }
}

void flushBrowserMidi() {
  bool resync = false;
  portENTER_CRITICAL(&browserMidiMux);
  if (browserMidiResyncPending) {
    // A missing Note Off is worse than a dropped animation sample. Discard the
    // stale backlog and publish authoritative held-note state before resuming.
    browserMidiEvents.clear();
    browserMidiResyncPending = false;
    ++browserMidiResyncs;
    resync = true;
  }
  portEXIT_CRITICAL(&browserMidiMux);
  if (resync) sendMidiStateSnapshot();

  for (size_t index = 0; index < kBrowserMidiFlushBatch; ++index) {
    BrowserMidiEvent event;
    portENTER_CRITICAL(&browserMidiMux);
    const bool available = browserMidiEvents.pop(event);
    portEXIT_CRITICAL(&browserMidiMux);
    if (!available) break;
    if (event.kind == BrowserMidiKind::Control) {
      sendMidiControl(event.channel, event.firstData, event.secondData, event.timestampMs);
    } else {
      sendMidiEvent(event.on, event.channel, event.firstData, event.secondData,
                    event.highResolutionVelocity, event.hasHighResolutionVelocity,
                    event.timestampMs);
    }
  }
}

void handleMidiPacket(void*, const uint8_t data[4], uint64_t receivedUs) {
  if (data == nullptr) return;
  const uint64_t dispatchedUs = static_cast<uint64_t>(esp_timer_get_time());
  portENTER_CRITICAL(&realtimeMetricsMux);
  midiDispatchLatency.observe(dispatchedUs >= receivedUs ? dispatchedUs - receivedUs : 0);
  portEXIT_CRITICAL(&realtimeMetricsMux);
  notefall::midi::DecodedMessage decoded;
  if (!notefall::midi::decodeUsbEventPacket(data, decoded)) return;
  const uint8_t status = decoded.status;
  const uint8_t command = decoded.command;
  const uint8_t firstData = decoded.data1;
  const uint8_t secondData = decoded.data2;
  const uint32_t timestampMs = static_cast<uint32_t>(receivedUs / 1000U);
  // PX-S7000 received messages target its sound-generator parts; the official
  // MIDI implementation does not define a MIDI Thru path back to its output.
  // Record suspicious byte-for-byte mirrors for commissioning, but never
  // discard an indistinguishable real key press based on timing heuristics.
  observeOutputMirrorCandidate(status, firstData, secondData, millis());
  if ((command == 0x80 || command == 0x90) && !validNote(firstData)) return;
  const uint8_t channel = decoded.channel;
  const auto highResolution = (command == 0x80 || command == 0x90)
      ? velocityTracker.consumeForNote(channel, secondData)
      : notefall::midi::HighResolutionVelocity{};
  const bool hasHighResolutionVelocity = highResolution.valid;
  const uint16_t highResolutionVelocity = highResolution.value;
  bool ledChanged = false;
  if (command == 0x90 && secondData > 0) {
    const uint8_t note = firstData;
    portENTER_CRITICAL(&ledStateMux);
    notes[noteIndex(note)].pressed = true;
    notes[noteIndex(note)].velocity = secondData;
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
    ledChanged = true;
    queueBrowserMidi(BrowserMidiKind::Note, true, channel, note, secondData, timestampMs,
                     highResolutionVelocity, hasHighResolutionVelocity);
  } else if (command == 0x80 || (command == 0x90 && secondData == 0)) {
    const uint8_t note = firstData;
    portENTER_CRITICAL(&ledStateMux);
    notes[noteIndex(note)].pressed = false;
    notes[noteIndex(note)].velocity = 0;
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
    ledChanged = true;
    queueBrowserMidi(BrowserMidiKind::Note, false, channel, note, secondData, timestampMs,
                     highResolutionVelocity, hasHighResolutionVelocity);
  } else if (command == 0xB0) {
    if (firstData == 88) {
      velocityTracker.observeControl(channel, firstData, secondData);
    }
    if (firstData == 120 || firstData == 123) {
      portENTER_CRITICAL(&ledStateMux);
      for (auto& note : notes) note.pressed = false;
      ledDirty = true;
      portEXIT_CRITICAL(&ledStateMux);
      if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
      ledChanged = true;
    }
    queueBrowserMidi(BrowserMidiKind::Control, false, channel, firstData, secondData, timestampMs);
  }
  if (ledChanged) notifyRealtime();
}

void onPianoConnected(void*) {
  pianoConnected.store(true);
  statusBroadcastRequested.store(true);
}

void onPianoDisconnected(void*) {
  pianoConnected.store(false);
  velocityTracker.clear();
  portENTER_CRITICAL(&ledStateMux);
  for (auto& note : notes) {
    note.pressed = false;
    note.target = false;
    note.velocity = 0;
  }
  lastTargetMs = 0;
  testNote = -1;
  ledDirty = true;
  portEXIT_CRITICAL(&ledStateMux);
  portENTER_CRITICAL(&browserMidiMux);
  browserMidiResyncPending = true;
  portEXIT_CRITICAL(&browserMidiMux);
  outputResetRequested.store(true);
  statusBroadcastRequested.store(true);
  notifyRealtime();
}

void serviceRealtimePipeline() {
  usbMidi.poll();
  renderStrip();
  realtimeHeartbeatMs.store(millis(), std::memory_order_relaxed);
  realtimeWakeups.fetch_add(1, std::memory_order_relaxed);
}

void realtimeTask(void*) {
  const bool watchdogArmed = esp_task_wdt_add(nullptr) == ESP_OK;
  realtimeWatchdogArmed.store(watchdogArmed);
  realtimeTaskReady.store(true);
  for (;;) {
    serviceRealtimePipeline();
    if (watchdogArmed) esp_task_wdt_reset();
    // USB input and UI mutations wake this immediately. The short timeout is
    // only a backstop for stale-target and calibration-test expiry.
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(kRealtimeIdlePollMs));
  }
}

void saveCalibration() {
  if (!preferencesReady) return;
  preferences.putUChar("brightness", brightness);
  preferences.putChar("offset", pixelOffset);
  preferences.putBool("reversed", stripReversed);
}

void handleWebMessage(uint8_t client, const uint8_t* payload, size_t length) {
  if (length == 0 || length > kMaxWebMessageBytes) {
    ++webMessagesRejected;
    return;
  }
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    ++webMessagesRejected;
    return;
  }
  const char* type = doc["t"] | "";

  if (strcmp(type, "hello") == 0) {
    const int received = doc["v"] | -1;
    webProtocolCompatible[client] = received == kProtocolVersion;
    const char* suppliedAuth = doc["auth"] | "";
    const char* suppliedToken = doc["token"] | "";
    const bool passwordSupplied = suppliedAuth[0] != '\0';
    const bool tokenSupplied = suppliedToken[0] != '\0';
    const bool credentialSupplied = passwordSupplied || tokenSupplied;
    const bool credentialMatches =
        (passwordSupplied && constantTimeEquals(String(suppliedAuth), activeApPassword)) ||
        (tokenSupplied && constantTimeEquals(String(suppliedToken), controlSessionToken));
    webControlAuthorized[client] = notefall::security::controlAuthorized(
        webProtocolCompatible[client], webAccessPointClient[client],
        credentialSupplied, credentialMatches);
    if (webProtocolCompatible[client] && credentialSupplied &&
        !webAccessPointClient[client] && !webControlAuthorized[client]) {
      ++webAuthRejected;
    }
    sendStatus(client);
    if (!webProtocolCompatible[client]) {
      ++webMessagesRejected;
      JsonDocument reply;
      reply["t"] = "protocolError";
      reply["expected"] = kProtocolVersion;
      reply["received"] = received;
      String encoded;
      serializeJson(reply, encoded);
      websocket.sendTXT(client, encoded);
      return;
    }
    if (webControlAuthorized[client]) sendCalibration(client);
    return;
  }
  // A stale or foreign client may observe status for diagnosis, but cannot
  // mutate lights, calibration, Wi-Fi credentials, or MIDI OUT until it has
  // completed a matching protocol handshake.
  if (!webProtocolCompatible[client]) {
    ++webMessagesRejected;
    return;
  }

  if (strcmp(type, "ping") == 0) {
    JsonDocument reply;
    reply["t"] = "pong";
    reply["ts"] = doc["ts"] | 0;
    reply["deviceTs"] = millis();
    String encoded;
    serializeJson(reply, encoded);
    websocket.sendTXT(client, encoded);
    return;
  }

  if (!webControlAuthorized[client]) {
    ++webMessagesRejected;
    return;
  }

  if (strcmp(type, "target") == 0) {
    bool targetSnapshot[kNoteCount]{};
    uint8_t handSnapshot[kNoteCount]{};
    const JsonArray targets = doc["notes"].as<JsonArray>();
    for (JsonObject target : targets) {
      const int note = target["n"] | -1;
      if (!validNote(note)) continue;
      const size_t index = noteIndex(static_cast<uint8_t>(note));
      targetSnapshot[index] = true;
      handSnapshot[index] = static_cast<uint8_t>(
          clampValue<int>(target["h"] | 1, 0, 1));
    }
    portENTER_CRITICAL(&ledStateMux);
    for (size_t index = 0; index < kNoteCount; ++index) {
      notes[index].target = targetSnapshot[index];
      notes[index].hand = handSnapshot[index];
    }
    lastTargetMs = millis();
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    notifyRealtime();
  } else if (strcmp(type, "config") == 0) {
    portENTER_CRITICAL(&ledStateMux);
    brightness = static_cast<uint8_t>(
        clampValue<int>(doc["brightness"] | brightness, 1, kMaxGlobalBrightness));
    pixelOffset = static_cast<int8_t>(
        clampValue<int>(doc["offset"] | pixelOffset, kMinPixelOffset, kMaxPixelOffset));
    stripReversed = doc["reversed"] | stripReversed;
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    notifyRealtime();
    saveCalibration();
    sendStatus();
  } else if (strcmp(type, "keyOffset") == 0) {
    const int note = doc["n"] | -1;
    if (!validNote(note)) return;
    const size_t index = noteIndex(static_cast<uint8_t>(note));
    portENTER_CRITICAL(&ledStateMux);
    keyPixelOffsets[index] = static_cast<int8_t>(clampValue<int>(
        doc["offset"] | keyPixelOffsets[index], -kMaxKeyPixelOffset, kMaxKeyPixelOffset));
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    notifyRealtime();
    if (preferencesReady) preferences.putBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
    sendCalibration();
  } else if (strcmp(type, "test") == 0) {
    const int note = doc["n"] | -1;
    if (validNote(note)) {
      portENTER_CRITICAL(&ledStateMux);
      testNote = note;
      testUntilMs = millis() + kTestNoteMs;
      ledDirty = true;
      portEXIT_CRITICAL(&ledStateMux);
      notifyRealtime();
    }
  } else if (strcmp(type, "blackout") == 0) {
    clearTargets();
    portENTER_CRITICAL(&ledStateMux);
    testNote = -1;
    for (auto& note : notes) {
      note.pressed = false;
      note.velocity = 0;
    }
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    notifyRealtime();
    panicMidiOutput();
    midiOutOwner = -1;
  } else if (strcmp(type, "midiPanic") == 0) {
    if (midiOutOwner < 0 || midiOutOwner == client) {
      panicMidiOutput();
      midiOutOwner = -1;
    }
  } else if (strcmp(type, "midiOut") == 0) {
    size_t accepted = 0;
    size_t received = 0;
    const bool ownerAvailable = midiOutOwner < 0 || midiOutOwner == client;
    if (usbMidi.outputAvailable() && ownerAvailable) {
      midiOutOwner = client;
      const uint32_t now = millis();
      const JsonArray events = doc["events"].as<JsonArray>();
      for (JsonObject event : events) {
        if (received++ >= 48) {
          ++webMessagesRejected;
          break;
        }
        const int status = event["s"] | -1;
        const int data1 = event["d1"] | -1;
        const int data2 = event["d2"] | 0;
        const uint32_t delayMs = static_cast<uint32_t>(clampValue<int>(
            event["delay"] | 0, 0, static_cast<int>(kMaxMidiScheduleDelayMs)));
        if (status < 0x80 || status > 0xEF || data1 < 0 || data1 > 127 ||
            data2 < 0 || data2 > 127) {
          ++webMessagesRejected;
          continue;
        }
        if (scheduleMidiMessage(now + delayMs, static_cast<uint8_t>(status),
                                static_cast<uint8_t>(data1), static_cast<uint8_t>(data2))) {
          ++accepted;
        }
      }
    }
    JsonDocument reply;
    reply["t"] = "midiOutResult";
    reply["ok"] = usbMidi.outputAvailable() && ownerAvailable;
    reply["busy"] = !ownerAvailable;
    reply["accepted"] = accepted;
    reply["queued"] = scheduledMidiCount;
    String encoded;
    serializeJson(reply, encoded);
    websocket.sendTXT(client, encoded);
  }
}

bool addressInNetwork(const IPAddress& remote, const IPAddress& local, const IPAddress& mask) {
  for (uint8_t octet = 0; octet < 4; ++octet) {
    if ((remote[octet] & mask[octet]) != (local[octet] & mask[octet])) return false;
  }
  return true;
}

bool websocketClientUsesAccessPoint(uint8_t client) {
  const IPAddress remote = websocket.remoteIP(client);
  const bool inAccessPointNetwork = addressInNetwork(
      remote, WiFi.softAPIP(), WiFi.softAPSubnetMask());
  // If the configured LAN overlaps the SoftAP subnet, fail closed and require
  // the hotspot password instead of guessing which interface accepted it.
  const bool alsoInStationNetwork = WiFi.status() == WL_CONNECTED &&
      addressInNetwork(remote, WiFi.localIP(), WiFi.subnetMask());
  return notefall::security::automaticAccessPointTrust(
      inAccessPointNetwork, alsoInStationNetwork);
}

void webSocketEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      webClients = std::min<uint8_t>(webClients + 1, 250);
      webProtocolCompatible[client] = false;
      webAccessPointClient[client] = websocketClientUsesAccessPoint(client);
      webControlAuthorized[client] = false;
      sendStatus(client);
      break;
    case WStype_DISCONNECTED:
      webProtocolCompatible[client] = false;
      webControlAuthorized[client] = false;
      webAccessPointClient[client] = false;
      if (webClients > 0) --webClients;
      if (midiOutOwner == client) {
        panicMidiOutput();
        midiOutOwner = -1;
      }
      if (webClients == 0) {
        clearTargets();
        panicMidiOutput();
      }
      break;
    case WStype_TEXT:
      handleWebMessage(client, payload, length);
      break;
    default:
      break;
  }
}

bool requestUsesAccessPoint() {
  return http.client().localIP() == WiFi.softAPIP();
}

bool updateRequestAuthorized() {
  return requestUsesAccessPoint() && http.hasHeader(kUpdateAuthHeader) &&
      constantTimeEquals(http.header(kUpdateAuthHeader), activeApPassword);
}

void sendUpdateInfo() {
  const esp_partition_t* running = esp_ota_get_running_partition();
  const esp_partition_t* next = esp_ota_get_next_update_partition(nullptr);
  const esp_partition_t* filesystem = esp_partition_find_first(
      ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
  JsonDocument doc;
  doc["firmware"] = kFirmwareVersion;
  doc["protocol"] = kProtocolVersion;
  doc["running"] = running ? running->label : "unknown";
  doc["firmwareMax"] = next ? next->size : 0;
  doc["filesystemMax"] = filesystem ? filesystem->size : 0;
  doc["apOnly"] = true;
  String body;
  serializeJson(doc, body);
  http.send(200, "application/json", body);
}

void restoreFilesystemAfterFailure() {
  if (!webUpdate.filesystemUnmounted) return;
  if (!LittleFS.begin(false, "/littlefs", 10, kLittleFsPartitionLabel)) {
    Serial.println("WARN: LittleFS could not remount after failed update");
  }
  webUpdate.filesystemUnmounted = false;
}

void handleUpdateUpload() {
  HTTPUpload& upload = http.upload();
  if (upload.status == UPLOAD_FILE_START) {
    webUpdate = WebUpdateState{};
    webUpdate.authorized = updateRequestAuthorized();
    if (!webUpdate.authorized) {
      webUpdate.error = requestUsesAccessPoint() ? "wrong hotspot password" : "connect to NoteFall-88 hotspot";
      return;
    }
    const String target = http.arg("target");
    int command = U_FLASH;
    if (target == "filesystem") {
      command = U_SPIFFS;
      LittleFS.end();
      webUpdate.filesystemUnmounted = true;
    } else if (target != "firmware") {
      webUpdate.error = "unknown update target";
      return;
    }
    clearTargets();
    portENTER_CRITICAL(&ledStateMux);
    testNote = -1;
    for (auto& note : notes) {
      note.pressed = false;
      note.velocity = 0;
    }
    ledDirty = true;
    portEXIT_CRITICAL(&ledStateMux);
    panicMidiOutput();
    midiOutOwner = -1;
    const uint32_t generationBefore = ledRenderGeneration.load(std::memory_order_acquire);
    notifyRealtime();
    // Ensure the LEDs are physically dark before flash writes can monopolize
    // the CPU. This runs outside the real-time task only during authorized OTA.
    const uint32_t blackoutDeadline = millis() + 100U;
    while (ledRenderGeneration.load(std::memory_order_acquire) == generationBefore &&
           !timeReached(millis(), blackoutDeadline)) {
      if (realtimeTaskHandle == nullptr) serviceRealtimePipeline();
      delay(1);
    }
    if (!Update.begin(UPDATE_SIZE_UNKNOWN, command)) {
      webUpdate.error = Update.errorString();
      restoreFilesystemAfterFailure();
      return;
    }
    webUpdate.started = true;
    Serial.printf("OTA start: %s (%s)\n", target.c_str(), upload.filename.c_str());
  } else if (upload.status == UPLOAD_FILE_WRITE) {
    if (!webUpdate.started || !webUpdate.error.isEmpty()) return;
    const size_t written = Update.write(upload.buf, upload.currentSize);
    webUpdate.written += written;
    if (written != upload.currentSize) webUpdate.error = Update.errorString();
  } else if (upload.status == UPLOAD_FILE_END) {
    if (!webUpdate.started || !webUpdate.error.isEmpty()) {
      if (webUpdate.started) Update.abort();
      restoreFilesystemAfterFailure();
      return;
    }
    webUpdate.success = Update.end(true);
    if (!webUpdate.success) {
      webUpdate.error = Update.errorString();
      restoreFilesystemAfterFailure();
    }
    Serial.printf("OTA end: %u bytes, success=%d\n",
                  static_cast<unsigned>(webUpdate.written), webUpdate.success);
  } else if (upload.status == UPLOAD_FILE_ABORTED) {
    if (webUpdate.started) Update.abort();
    webUpdate.error = "upload aborted";
    restoreFilesystemAfterFailure();
  }
}

void finishUpdateRequest() {
  JsonDocument doc;
  doc["ok"] = webUpdate.success;
  doc["written"] = webUpdate.written;
  if (!webUpdate.success) doc["error"] = webUpdate.error.isEmpty() ? "update failed" : webUpdate.error;
  String body;
  serializeJson(doc, body);
  const int status = webUpdate.success ? 200 : (webUpdate.authorized ? 400 : 403);
  http.send(status, "application/json", body);
  if (webUpdate.success) restartRequested = true;
}

void changeAccessPointPassword() {
  JsonDocument doc;
  if (!updateRequestAuthorized()) {
    doc["ok"] = false;
    doc["error"] = requestUsesAccessPoint() ? "current password is wrong" : "connect to NoteFall-88 hotspot";
    String body;
    serializeJson(doc, body);
    http.send(403, "application/json", body);
    return;
  }
  const String next = http.arg("next");
  if (next.length() < 8 || next.length() > 63) {
    http.send(400, "application/json", "{\"ok\":false,\"error\":\"password must be 8-63 UTF-8 bytes\"}");
    return;
  }
  preferences.putString("apPass", next);
  activeApPassword = next;
  http.send(200, "application/json", "{\"ok\":true,\"restart\":true}");
  restartRequested = true;
}

void saveStationWifi() {
  if (!updateRequestAuthorized()) {
    http.send(403, "application/json", requestUsesAccessPoint()
        ? "{\"ok\":false,\"error\":\"current password is wrong\"}"
        : "{\"ok\":false,\"error\":\"connect to NoteFall-88 hotspot\"}");
    return;
  }
  const String ssid = http.arg("ssid");
  const String password = http.arg("password");
  const bool passwordValid = password.isEmpty() ||
      (password.length() >= 8 && password.length() <= 63);
  if (ssid.isEmpty() || ssid.length() > 32 || !passwordValid) {
    http.send(400, "application/json",
              "{\"ok\":false,\"error\":\"SSID must be 1-32 bytes and password empty or 8-63 bytes\"}");
    return;
  }
  preferences.putString("wifiSsid", ssid);
  preferences.putString("wifiPass", password);
  http.send(200, "application/json", "{\"ok\":true,\"restart\":true}");
  restartRequested = true;
}

void startNetwork() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.setHostname(kHostname);
  activeApPassword = preferences.getString("apPass", kApPassword);
  if (activeApPassword.length() < 8 || activeApPassword.length() > 63) activeApPassword = kApPassword;
  WiFi.softAP(kApSsid, activeApPassword.c_str());
  const String ssid = preferences.getString("wifiSsid", "");
  const String password = preferences.getString("wifiPass", "");
  if (!ssid.isEmpty()) WiFi.begin(ssid.c_str(), password.c_str());

  http.on("/api/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["project"] = "NoteFall 88";
    doc["piano"] = pianoConnected.load();
    doc["apIp"] = WiFi.softAPIP().toString();
    doc["stationIp"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
    String body;
    serializeJson(doc, body);
    http.send(200, "application/json", body);
  });
  const char* collectedHeaders[] = {kUpdateAuthHeader};
  http.collectHeaders(collectedHeaders, 1);
  http.on("/api/update-info", HTTP_GET, sendUpdateInfo);
  http.on("/api/update", HTTP_POST, finishUpdateRequest, handleUpdateUpload);
  http.on("/api/ap-password", HTTP_POST, changeAccessPointPassword);
  http.on("/api/wifi", HTTP_POST, saveStationWifi);
  // Arduino-ESP32 2.x defaults directory roots to /index.htm (without the
  // final "l"), so register our Vite entry file explicitly and serve hashed
  // assets from their own prefix.
  http.serveStatic("/", LittleFS, "/index.html", "no-cache");
  http.serveStatic("/assets/", LittleFS, "/assets/", "max-age=31536000, immutable");
  http.onNotFound([]() {
    if (LittleFS.exists("/index.html")) {
      http.sendHeader("Location", "/", true);
      http.send(302, "text/plain", "");
    } else {
      http.send(503, "text/plain", "NoteFall web UI is not flashed; run PlatformIO uploadfs");
    }
  });
  http.begin();
  websocket.begin();
  websocket.onEvent(webSocketEvent);
}

void recoverHttpAfterAccessPointDeparture() {
  const uint8_t stationCount = WiFi.softAPgetStationNum();
  if (previousApStationCount > 0 && stationCount == 0) {
    // Arduino WebServer::close() does not clear its current client. When a
    // browser leaves the SoftAP, that stale client can keep handleClient()
    // waiting forever and starve otherwise valid requests arriving on STA.
    // Stop the shared socket explicitly before reopening the listener.
    WiFiClient staleClient = http.client();
    staleClient.stop();
    http.stop();
    http.begin();
  }
  previousApStationCount = stationCount;
}

}  // namespace

void setup() {
  bootResetReason = esp_reset_reason();
  Serial.begin(115200);
  delay(150);
  if (ESP.getPsramSize() == 0) {
    Serial.println("WARN: N8R8 PSRAM not detected; verify qio_opi/OPI board settings");
  } else {
    Serial.printf("PSRAM ready: %u bytes\n", ESP.getPsramSize());
  }
  preferencesReady = preferences.begin("notefall", false);
  controlSessionToken = generateControlSessionToken();
  if (!preferencesReady) {
    Serial.println("WARN: NVS unavailable; calibration will not persist");
  } else {
    brightness = clampValue<uint8_t>(preferences.getUChar("brightness", kDefaultGlobalBrightness),
                                     static_cast<uint8_t>(1), kMaxGlobalBrightness);
    pixelOffset = static_cast<int8_t>(clampValue<int>(preferences.getChar("offset", 0),
                                                      kMinPixelOffset, kMaxPixelOffset));
    stripReversed = preferences.getBool("reversed", false);
    if (preferences.getBytesLength("keyOffsets") == sizeof(keyPixelOffsets)) {
      preferences.getBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
      bool repaired = false;
      for (int8_t& offset : keyPixelOffsets) {
        const int8_t bounded = static_cast<int8_t>(
            clampValue<int>(offset, -kMaxKeyPixelOffset, kMaxKeyPixelOffset));
        repaired = repaired || bounded != offset;
        offset = bounded;
      }
      if (repaired) {
        preferences.putBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
        Serial.println("WARN: invalid stored per-key offsets were clamped");
      }
    }
  }

  if (!strip.begin()) Serial.println("FATAL: LED strip allocation failed");
  if (!LittleFS.begin(true, "/littlefs", 10, kLittleFsPartitionLabel)) {
    Serial.println("WARN: LittleFS unavailable; web UI will not load");
  }
  startNetwork();

  usbMidi.setMidiCallback(handleMidiPacket, nullptr);
  usbMidi.setConnectionCallbacks(onPianoConnected, onPianoDisconnected, nullptr);
  if (!usbMidi.begin()) Serial.printf("USB host start failed: %s\n", usbMidi.lastError().c_str());
  portENTER_CRITICAL(&ledStateMux);
  ledDirty = true;
  portEXIT_CRITICAL(&ledStateMux);
  if (xTaskCreatePinnedToCore(realtimeTask, "notefall_realtime", kRealtimeTaskStackBytes,
                              nullptr, kRealtimeTaskPriority, &realtimeTaskHandle, 0) != pdPASS) {
    realtimeTaskHandle = nullptr;
    Serial.println("WARN: real-time task allocation failed; using main-loop fallback");
  } else {
    usbMidi.setConsumerTask(realtimeTaskHandle);
    notifyRealtime();
  }
}

void loop() {
  const int64_t loopStartedUs = esp_timer_get_time();
  if (realtimeTaskHandle == nullptr) serviceRealtimePipeline();
  if (outputResetRequested.exchange(false)) {
    midiOutOwner = -1;
    scheduledMidiCount = 0;
    panicMidiOutput();
  }
  flushBrowserMidi();
  processScheduledMidi();
  recoverHttpAfterAccessPointDeparture();
  http.handleClient();
  websocket.loop();

  if (!mdnsStarted && (WiFi.status() == WL_CONNECTED || WiFi.softAPgetStationNum() > 0)) {
    mdnsStarted = MDNS.begin(kHostname);
    if (mdnsStarted) MDNS.addService("http", "tcp", kHttpPort);
  }

  const uint32_t now = millis();
  if (statusBroadcastRequested.exchange(false) ||
      now - lastStatusMs >= kStatusBroadcastMs) {
    lastStatusMs = now;
    sendStatus();
  }
  if (restartRequested) {
    delay(300);
    ESP.restart();
  }
  const int64_t elapsedUs = esp_timer_get_time() - loopStartedUs;
  mainLoopLastUs = static_cast<uint32_t>(
      std::min<int64_t>(std::max<int64_t>(0, elapsedUs), UINT32_MAX));
  mainLoopMaxUs = std::max(mainLoopMaxUs, mainLoopLastUs);
  delay(1);
}
