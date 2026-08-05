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

struct EchoGuard {
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

Apa102Strip strip(kPixelCount, kDataPin, kClockPin, kSpiHz);
notefall::UsbMidiHost usbMidi;
WebServer http(kHttpPort);
WebSocketsServer websocket(kWebSocketPort);
Preferences preferences;
NoteState notes[kNoteCount];

bool pianoConnected = false;
bool mdnsStarted = false;
bool restartRequested = false;
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
constexpr size_t kEchoGuardCapacity = 48;
ScheduledMidiMessage scheduledMidi[kScheduledMidiCapacity]{};
size_t scheduledMidiCount = 0;
EchoGuard echoGuards[kEchoGuardCapacity]{};
size_t nextEchoGuard = 0;
uint32_t midiScheduleDropped = 0;
uint32_t midiEchoSuppressed = 0;
int16_t midiOutOwner = -1;
String activeApPassword;
WebUpdateState webUpdate;

constexpr Rgb kLeftTarget{28, 178, 255};
constexpr Rgb kRightTarget{255, 42, 175};
constexpr Rgb kCorrect{35, 255, 104};
constexpr Rgb kWrong{255, 55, 28};
constexpr Rgb kTest{255, 210, 32};
constexpr int8_t kMaxKeyPixelOffset = 4;
constexpr uint32_t kMaxMidiScheduleDelayMs = 60000;
constexpr uint32_t kEchoGuardMs = 80;
constexpr char kUpdateAuthHeader[] = "X-NoteFall-Admin";

template <typename T>
T clampValue(T value, T low, T high) {
  return value < low ? low : (value > high ? high : value);
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

void registerEchoGuard(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
  EchoGuard& guard = echoGuards[nextEchoGuard];
  guard.expiresMs = now + kEchoGuardMs;
  guard.status = status;
  guard.data1 = data1;
  guard.data2 = data2;
  nextEchoGuard = (nextEchoGuard + 1) % kEchoGuardCapacity;
}

bool consumeOutputEcho(uint8_t status, uint8_t data1, uint8_t data2, uint32_t now) {
  for (auto& guard : echoGuards) {
    if (guard.expiresMs == 0 || timeReached(now, guard.expiresMs)) {
      guard.expiresMs = 0;
      continue;
    }
    const bool exact = guard.status == status && guard.data1 == data1 && guard.data2 == data2;
    const bool guardIsOff = (guard.status & 0xF0U) == 0x80U ||
        ((guard.status & 0xF0U) == 0x90U && guard.data2 == 0);
    const bool messageIsOff = (status & 0xF0U) == 0x80U ||
        ((status & 0xF0U) == 0x90U && data2 == 0);
    const bool equivalentNoteOff = guardIsOff && messageIsOff &&
        (guard.status & 0x0FU) == (status & 0x0FU) && guard.data1 == data1;
    if (exact || equivalentNoteOff) {
      guard.expiresMs = 0;
      ++midiEchoSuppressed;
      return true;
    }
  }
  return false;
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
  for (auto& guard : echoGuards) guard.expiresMs = 0;
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
    registerEchoGuard(message.status, message.data1, message.data2, now);
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
  doc["usbEchoSuppressed"] = midiEchoSuppressed;
  doc["usbOutOwned"] = midiOutOwner >= 0;
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

void sendMidiEvent(bool on, uint8_t channel, uint8_t note, uint8_t velocity) {
  JsonDocument doc;
  doc["t"] = "midi";
  doc["s"] = on ? "on" : "off";
  doc["ch"] = channel;
  doc["n"] = note;
  doc["v"] = velocity;
  doc["ts"] = millis();
  String payload;
  serializeJson(doc, payload);
  websocket.broadcastTXT(payload);
}

void sendMidiControl(uint8_t channel, uint8_t controller, uint8_t value) {
  JsonDocument doc;
  doc["t"] = "control";
  doc["ch"] = channel;
  doc["c"] = controller;
  doc["v"] = value;
  doc["ts"] = millis();
  String payload;
  serializeJson(doc, payload);
  websocket.broadcastTXT(payload);
}

void handleMidiPacket(void*, const uint8_t data[4]) {
  if (data == nullptr) return;
  const uint8_t status = data[1];
  const uint8_t command = status & 0xF0;
  const uint8_t firstData = data[2];
  const uint8_t secondData = data[3];
  if (consumeOutputEcho(status, firstData, secondData, millis())) return;
  if ((command == 0x80 || command == 0x90) && !validNote(firstData)) return;
  const uint8_t channel = static_cast<uint8_t>((status & 0x0F) + 1);
  if (command == 0x90 && secondData > 0) {
    const uint8_t note = firstData;
    notes[noteIndex(note)].pressed = true;
    notes[noteIndex(note)].velocity = secondData;
    sendMidiEvent(true, channel, note, secondData);
  } else if (command == 0x80 || (command == 0x90 && secondData == 0)) {
    const uint8_t note = firstData;
    notes[noteIndex(note)].pressed = false;
    notes[noteIndex(note)].velocity = 0;
    sendMidiEvent(false, channel, note, secondData);
  } else if (command == 0xB0) {
    if (firstData == 120 || firstData == 123) {
      for (auto& note : notes) note.pressed = false;
    }
    sendMidiControl(channel, firstData, secondData);
  }
}

void onPianoConnected(void*) {
  pianoConnected = true;
  sendStatus();
}

void onPianoDisconnected(void*) {
  pianoConnected = false;
  midiOutOwner = -1;
  scheduledMidiCount = 0;
  for (auto& guard : echoGuards) guard.expiresMs = 0;
  for (auto& note : notes) note.pressed = false;
  clearTargets();
  lastTargetMs = 0;
  sendStatus();
}

void saveCalibration() {
  preferences.putUChar("brightness", brightness);
  preferences.putChar("offset", pixelOffset);
  preferences.putBool("reversed", stripReversed);
}

void handleWebMessage(uint8_t client, const uint8_t* payload, size_t length) {
  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) return;
  const char* type = doc["t"] | "";

  if (strcmp(type, "hello") == 0) {
    sendStatus(client);
    sendCalibration(client);
  } else if (strcmp(type, "target") == 0) {
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
    preferences.putBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
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
    const bool ownerAvailable = midiOutOwner < 0 || midiOutOwner == client;
    if (usbMidi.outputAvailable() && ownerAvailable) {
      midiOutOwner = client;
      const uint32_t now = millis();
      const JsonArray events = doc["events"].as<JsonArray>();
      for (JsonObject event : events) {
        const int status = event["s"] | -1;
        const int data1 = event["d1"] | -1;
        const int data2 = event["d2"] | 0;
        const uint32_t delayMs = static_cast<uint32_t>(clampValue<int>(
            event["delay"] | 0, 0, static_cast<int>(kMaxMidiScheduleDelayMs)));
        if (status < 0 || status > 255 || data1 < 0 || data1 > 127 ||
            data2 < 0 || data2 > 127) continue;
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
  } else if (strcmp(type, "wifi") == 0) {
    const String ssid = doc["ssid"] | "";
    const String password = doc["password"] | "";
    if (!ssid.isEmpty()) {
      preferences.putString("wifiSsid", ssid);
      preferences.putString("wifiPass", password);
      websocket.sendTXT(client, "{\"t\":\"wifiSaved\"}");
      restartRequested = true;
    }
  }
}

void webSocketEvent(uint8_t client, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      webClients = std::min<uint8_t>(webClients + 1, 250);
      sendStatus(client);
      break;
    case WStype_DISCONNECTED:
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
  Serial.begin(115200);
  delay(150);
  if (ESP.getPsramSize() == 0) {
    Serial.println("WARN: N8R8 PSRAM not detected; verify qio_opi/OPI board settings");
  } else {
    Serial.printf("PSRAM ready: %u bytes\n", ESP.getPsramSize());
  }
  preferences.begin("notefall", false);
  brightness = clampValue<uint8_t>(preferences.getUChar("brightness", kDefaultGlobalBrightness),
                                   static_cast<uint8_t>(1), kMaxGlobalBrightness);
  pixelOffset = static_cast<int8_t>(clampValue<int>(preferences.getChar("offset", 0),
                                                    kMinPixelOffset, kMaxPixelOffset));
  stripReversed = preferences.getBool("reversed", false);
  if (preferences.getBytesLength("keyOffsets") == sizeof(keyPixelOffsets)) {
    preferences.getBytes("keyOffsets", keyPixelOffsets, sizeof(keyPixelOffsets));
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
