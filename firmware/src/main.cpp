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
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>
#include <esp_timer.h>

#include "Apa102Strip.h"
#include "UsbMidiHost.h"
#include "app_config.h"
#include "layout_generated.h"

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
uint8_t pendingVelocityLsb[16] = {};
bool pendingVelocityLsbValid[16] = {};

bool pianoConnected = false;
bool mdnsStarted = false;
bool restartRequested = false;
bool preferencesReady = false;
esp_reset_reason_t bootResetReason = ESP_RST_UNKNOWN;
uint8_t webClients = 0;
uint8_t brightness = kDefaultGlobalBrightness;
int8_t pixelOffset = 0;
int8_t keyPixelOffsets[kNoteCount]{};
bool stripReversed = false;
uint32_t lastTargetMs = 0;
uint32_t lastLedRefreshMs = 0;
uint32_t lastStatusMs = 0;
int16_t testNote = -1;
uint32_t testUntilMs = 0;
constexpr size_t kScheduledMidiCapacity = 256;
constexpr size_t kOutputMirrorProbeCapacity = 48;
constexpr size_t kBrowserMidiCapacity = 64;
ScheduledMidiMessage scheduledMidi[kScheduledMidiCapacity]{};
size_t scheduledMidiCount = 0;
OutputMirrorProbe outputMirrorProbes[kOutputMirrorProbeCapacity]{};
size_t nextOutputMirrorProbe = 0;
uint32_t midiScheduleDropped = 0;
uint32_t midiOutputMirrorCandidates = 0;
int16_t midiOutOwner = -1;
bool webProtocolCompatible[256]{};
uint32_t webMessagesRejected = 0;
BrowserMidiEvent browserMidiEvents[kBrowserMidiCapacity]{};
size_t browserMidiCount = 0;
uint32_t browserMidiDropped = 0;
uint64_t pendingLedInputUs = 0;
uint64_t ledInputLatencyTotalUs = 0;
uint32_t ledInputLatencyLastUs = 0;
uint32_t ledInputLatencyMaxUs = 0;
uint32_t ledInputLatencySamples = 0;
String activeApPassword;
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

int mappedPixel(uint8_t note) {
  if (!validNote(note)) return -1;
  const size_t index = noteIndex(note);
  int pixel = static_cast<int>(kPixelByNote[index]) + pixelOffset + keyPixelOffsets[index];
  if (stripReversed) pixel = static_cast<int>(kPixelCount) - 1 - pixel;
  return pixel >= 0 && pixel < static_cast<int>(kPixelCount) ? pixel : -1;
}

bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

bool validOutputMessage(uint8_t status, uint8_t data1, uint8_t data2) {
  if ((status & 0x80U) == 0 || data1 > 127 || data2 > 127) return false;
  const uint8_t command = status & 0xF0U;
  return command >= 0x80U && command <= 0xE0U;
}

void registerOutputMirrorProbe(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
  OutputMirrorProbe& probe = outputMirrorProbes[nextOutputMirrorProbe];
  probe.expiresMs = now + kOutputMirrorProbeMs;
  probe.status = status;
  probe.data1 = data1;
  probe.data2 = data2;
  nextOutputMirrorProbe = (nextOutputMirrorProbe + 1) % kOutputMirrorProbeCapacity;
}

void observeOutputMirrorCandidate(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
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
      return;
    }
  }
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
  for (auto& probe : outputMirrorProbes) probe.expiresMs = 0;
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
  size_t index = 0;
  while (index < scheduledMidiCount) {
    const ScheduledMidiMessage message = scheduledMidi[index];
    if (!timeReached(now, message.dueMs)) {
      ++index;
      continue;
    }
    if (!usbMidi.sendMidiMessage(message.status, message.data1, message.data2)) {
      ++index;
      continue;
    }
    registerOutputMirrorProbe(message.status, message.data1, message.data2, now);
    for (size_t move = index + 1; move < scheduledMidiCount; ++move) {
      scheduledMidi[move - 1] = scheduledMidi[move];
    }
    --scheduledMidiCount;
  }
}

void clearTargets() {
  for (auto& note : notes) note.target = false;
}

void renderStrip() {
  strip.clear();
  const uint32_t now = millis();
  if (lastTargetMs != 0 && now - lastTargetMs > kTargetStaleMs) {
    clearTargets();
    lastTargetMs = 0;
  }
  if (testNote >= 0 && now >= testUntilMs) testNote = -1;

  for (uint8_t midiNote = kFirstMidiNote; midiNote <= kLastMidiNote; ++midiNote) {
    const size_t index = noteIndex(midiNote);
    const int pixel = mappedPixel(midiNote);
    if (pixel < 0) continue;
    Rgb color{};
    if (notes[index].target) color = notes[index].hand == 0 ? kLeftTarget : kRightTarget;
    if (notes[index].pressed) color = notes[index].target ? kCorrect : kWrong;
    if (midiNote == testNote) color = kTest;
    strip.setPixel(static_cast<size_t>(pixel), color);
  }
  strip.show(std::min<uint8_t>(brightness, kMaxGlobalBrightness));
  if (pendingLedInputUs != 0) {
    const uint64_t elapsed = static_cast<uint64_t>(esp_timer_get_time()) - pendingLedInputUs;
    const uint32_t sample = static_cast<uint32_t>(std::min<uint64_t>(elapsed, UINT32_MAX));
    ledInputLatencyLastUs = sample;
    ledInputLatencyMaxUs = std::max(ledInputLatencyMaxUs, sample);
    ledInputLatencyTotalUs += sample;
    ++ledInputLatencySamples;
    pendingLedInputUs = 0;
  }
}

void sendStatus(uint8_t client = 255) {
  const auto usb = usbMidi.diagnostics();
  JsonDocument doc;
  doc["t"] = "status";
  doc["protocol"] = kProtocolVersion;
  doc["firmware"] = kFirmwareVersion;
  doc["piano"] = pianoConnected;
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
  doc["usbErrors"] = usb.transferErrors;
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
  doc["usbOutputMirrorCandidates"] = midiOutputMirrorCandidates;
  doc["usbOutOwned"] = midiOutOwner >= 0;
  doc["webRejected"] = webMessagesRejected;
  doc["webMidiDropped"] = browserMidiDropped;
  doc["ledInputLatencyLastUs"] = ledInputLatencyLastUs;
  doc["ledInputLatencyAvgUs"] = ledInputLatencySamples == 0
      ? 0
      : static_cast<uint32_t>(ledInputLatencyTotalUs / ledInputLatencySamples);
  doc["ledInputLatencyMaxUs"] = ledInputLatencyMaxUs;
  doc["ledInputLatencySamples"] = ledInputLatencySamples;
  String payload;
  serializeJson(doc, payload);
  if (client == 255) websocket.broadcastTXT(payload);
  else websocket.sendTXT(client, payload);
}

void sendCalibration(uint8_t client = 255) {
  JsonDocument doc;
  doc["t"] = "calibration";
  JsonArray offsets = doc["offsets"].to<JsonArray>();
  for (const int8_t offset : keyPixelOffsets) offsets.add(offset);
  String payload;
  serializeJson(doc, payload);
  if (client == 255) websocket.broadcastTXT(payload);
  else websocket.sendTXT(client, payload);
}

void sendMidiEvent(bool on, uint8_t channel, uint8_t note, uint8_t velocity,
                   uint16_t highResolutionVelocity, bool hasHighResolutionVelocity,
                   uint32_t timestampMs) {
  JsonDocument doc;
  doc["t"] = "midi";
  doc["s"] = on ? "on" : "off";
  doc["ch"] = channel;
  doc["n"] = note;
  doc["v"] = velocity;
  if (hasHighResolutionVelocity) doc["vh"] = highResolutionVelocity;
  doc["ts"] = timestampMs;
  String payload;
  serializeJson(doc, payload);
  websocket.broadcastTXT(payload);
}

void sendMidiControl(uint8_t channel, uint8_t controller, uint8_t value, uint32_t timestampMs) {
  JsonDocument doc;
  doc["t"] = "control";
  doc["ch"] = channel;
  doc["c"] = controller;
  doc["v"] = value;
  doc["ts"] = timestampMs;
  String payload;
  serializeJson(doc, payload);
  websocket.broadcastTXT(payload);
}

void queueBrowserMidi(BrowserMidiKind kind, bool on, uint8_t channel,
                      uint8_t firstData, uint8_t secondData, uint32_t timestampMs,
                      uint16_t highResolutionVelocity = 0,
                      bool hasHighResolutionVelocity = false) {
  if (browserMidiCount >= kBrowserMidiCapacity) {
    ++browserMidiDropped;
    return;
  }
  BrowserMidiEvent& event = browserMidiEvents[browserMidiCount++];
  event.kind = kind;
  event.on = on;
  event.channel = channel;
  event.firstData = firstData;
  event.secondData = secondData;
  event.highResolutionVelocity = highResolutionVelocity;
  event.hasHighResolutionVelocity = hasHighResolutionVelocity;
  event.timestampMs = timestampMs;
}

void flushBrowserMidi() {
  for (size_t index = 0; index < browserMidiCount; ++index) {
    const BrowserMidiEvent& event = browserMidiEvents[index];
    if (event.kind == BrowserMidiKind::Control) {
      sendMidiControl(event.channel, event.firstData, event.secondData, event.timestampMs);
    } else {
      sendMidiEvent(event.on, event.channel, event.firstData, event.secondData,
                    event.highResolutionVelocity, event.hasHighResolutionVelocity,
                    event.timestampMs);
    }
  }
  browserMidiCount = 0;
}

void handleMidiPacket(void*, const uint8_t data[4], uint64_t receivedUs) {
  if (data == nullptr) return;
  const uint8_t status = data[1];
  const uint8_t command = status & 0xF0;
  const uint8_t firstData = data[2];
  const uint8_t secondData = data[3];
  const uint32_t timestampMs = static_cast<uint32_t>(receivedUs / 1000U);
  // PX-S7000 received messages target its sound-generator parts; the official
  // MIDI implementation does not define a MIDI Thru path back to its output.
  // Record suspicious byte-for-byte mirrors for commissioning, but never
  // discard an indistinguishable real key press based on timing heuristics.
  observeOutputMirrorCandidate(status, firstData, secondData, millis());
  if ((command == 0x80 || command == 0x90) && !validNote(firstData)) return;
  const uint8_t channel = static_cast<uint8_t>((status & 0x0F) + 1);
  const uint8_t channelIndex = static_cast<uint8_t>(channel - 1);
  const bool hasHighResolutionVelocity = pendingVelocityLsbValid[channelIndex]
      && (command == 0x80 || command == 0x90);
  const uint16_t highResolutionVelocity = static_cast<uint16_t>(
      (static_cast<uint16_t>(secondData) << 7U) | pendingVelocityLsb[channelIndex]);
  if (hasHighResolutionVelocity) pendingVelocityLsbValid[channelIndex] = false;
  if (command == 0x90 && secondData > 0) {
    const uint8_t note = firstData;
    notes[noteIndex(note)].pressed = true;
    notes[noteIndex(note)].velocity = secondData;
    if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
    queueBrowserMidi(BrowserMidiKind::Note, true, channel, note, secondData, timestampMs,
                     highResolutionVelocity, hasHighResolutionVelocity);
  } else if (command == 0x80 || (command == 0x90 && secondData == 0)) {
    const uint8_t note = firstData;
    notes[noteIndex(note)].pressed = false;
    notes[noteIndex(note)].velocity = 0;
    if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
    queueBrowserMidi(BrowserMidiKind::Note, false, channel, note, secondData, timestampMs,
                     highResolutionVelocity, hasHighResolutionVelocity);
  } else if (command == 0xB0) {
    if (firstData == 88) {
      pendingVelocityLsb[channelIndex] = secondData;
      pendingVelocityLsbValid[channelIndex] = true;
    }
    if (firstData == 120 || firstData == 123) {
      for (auto& note : notes) note.pressed = false;
      if (pendingLedInputUs == 0 || receivedUs < pendingLedInputUs) pendingLedInputUs = receivedUs;
    }
    queueBrowserMidi(BrowserMidiKind::Control, false, channel, firstData, secondData, timestampMs);
  }
}

void onPianoConnected(void*) {
  pianoConnected = true;
  sendStatus();
}

void onPianoDisconnected(void*) {
  pianoConnected = false;
  std::fill(std::begin(pendingVelocityLsbValid), std::end(pendingVelocityLsbValid), false);
  midiOutOwner = -1;
  scheduledMidiCount = 0;
  for (auto& probe : outputMirrorProbes) probe.expiresMs = 0;
  for (auto& note : notes) note.pressed = false;
  clearTargets();
  lastTargetMs = 0;
  sendStatus();
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
    sendCalibration(client);
    return;
  }
  // A stale or foreign client may observe status for diagnosis, but cannot
  // mutate lights, calibration, Wi-Fi credentials, or MIDI OUT until it has
  // completed a matching protocol handshake.
  if (!webProtocolCompatible[client]) {
    ++webMessagesRejected;
    return;
  }

  if (strcmp(type, "target") == 0) {
    clearTargets();
    const JsonArray targets = doc["notes"].as<JsonArray>();
    for (JsonObject target : targets) {
      const int note = target["n"] | -1;
      if (!validNote(note)) continue;
      NoteState& state = notes[noteIndex(static_cast<uint8_t>(note))];
      state.target = true;
      state.hand = static_cast<uint8_t>(clampValue<int>(target["h"] | 1, 0, 1));
    }
    lastTargetMs = millis();
  } else if (strcmp(type, "config") == 0) {
    brightness = static_cast<uint8_t>(
        clampValue<int>(doc["brightness"] | brightness, 1, kMaxGlobalBrightness));
    pixelOffset = static_cast<int8_t>(
        clampValue<int>(doc["offset"] | pixelOffset, kMinPixelOffset, kMaxPixelOffset));
    stripReversed = doc["reversed"] | stripReversed;
    saveCalibration();
    sendStatus();
  } else if (strcmp(type, "keyOffset") == 0) {
    const int note = doc["n"] | -1;
    if (!validNote(note)) return;
    const size_t index = noteIndex(static_cast<uint8_t>(note));
    keyPixelOffsets[index] = static_cast<int8_t>(clampValue<int>(
        doc["offset"] | keyPixelOffsets[index], -kMaxKeyPixelOffset, kMaxKeyPixelOffset));
    if (preferencesReady) preferences.putBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
    sendCalibration();
  } else if (strcmp(type, "test") == 0) {
    const int note = doc["n"] | -1;
    if (validNote(note)) {
      testNote = note;
      testUntilMs = millis() + kTestNoteMs;
    }
  } else if (strcmp(type, "blackout") == 0) {
    clearTargets();
    testNote = -1;
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
  } else if (strcmp(type, "ping") == 0) {
    JsonDocument reply;
    reply["t"] = "pong";
    reply["ts"] = doc["ts"] | 0;
    String encoded;
    serializeJson(reply, encoded);
    websocket.sendTXT(client, encoded);
  }
}

void webSocketEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      webClients = std::min<uint8_t>(webClients + 1, 250);
      webProtocolCompatible[client] = false;
      sendStatus(client);
      break;
    case WStype_DISCONNECTED:
      webProtocolCompatible[client] = false;
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
  if (!LittleFS.begin(false)) Serial.println("WARN: LittleFS could not remount after failed update");
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
    testNote = -1;
    panicMidiOutput();
    midiOutOwner = -1;
    renderStrip();
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
    http.send(400, "application/json", "{\"ok\":false,\"error\":\"password must be 8-63 characters\"}");
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
    doc["piano"] = pianoConnected;
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
  if (!LittleFS.begin(true)) Serial.println("WARN: LittleFS unavailable; web UI will not load");
  startNetwork();

  usbMidi.setMidiCallback(handleMidiPacket, nullptr);
  usbMidi.setConnectionCallbacks(onPianoConnected, onPianoDisconnected, nullptr);
  if (!usbMidi.begin()) Serial.printf("USB host start failed: %s\n", usbMidi.lastError().c_str());
  renderStrip();
}

void loop() {
  usbMidi.poll();
  // Flush all note changes from the just-drained USB queue in one SPI frame.
  // This removes the former arbitrary 0-10 ms wait without issuing one frame
  // per note in a chord. The sample ends after the physical SPI transfer.
  if (pendingLedInputUs != 0) {
    renderStrip();
    lastLedRefreshMs = millis();
  }
  flushBrowserMidi();
  processScheduledMidi();
  http.handleClient();
  websocket.loop();

  if (!mdnsStarted && (WiFi.status() == WL_CONNECTED || WiFi.softAPgetStationNum() > 0)) {
    mdnsStarted = MDNS.begin(kHostname);
    if (mdnsStarted) MDNS.addService("http", "tcp", kHttpPort);
  }

  const uint32_t now = millis();
  if (now - lastLedRefreshMs >= kLedRefreshMs) {
    lastLedRefreshMs = now;
    renderStrip();
  }
  if (now - lastStatusMs >= kStatusBroadcastMs) {
    lastStatusMs = now;
    sendStatus();
  }
  if (restartRequested) {
    delay(300);
    ESP.restart();
  }
  delay(1);
}
