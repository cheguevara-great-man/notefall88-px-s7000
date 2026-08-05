#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

#include <algorithm>

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

constexpr Rgb kLeftTarget{28, 178, 255};
constexpr Rgb kRightTarget{255, 42, 175};
constexpr Rgb kCorrect{35, 255, 104};
constexpr Rgb kWrong{255, 55, 28};
constexpr Rgb kTest{255, 210, 32};
constexpr int8_t kMaxKeyPixelOffset = 4;

template <typename T>
T clampValue(T value, T low, T high) {
  return value < low ? low : (value > high ? high : value);
}

bool validNote(int note) { return note >= kFirstMidiNote && note <= kLastMidiNote; }

size_t noteIndex(uint8_t note) { return static_cast<size_t>(note - kFirstMidiNote); }

int mappedPixel(uint8_t note) {
  if (!validNote(note)) return -1;
  const size_t index = noteIndex(note);
  int pixel = static_cast<int>(kPixelByNote[index]) + pixelOffset + keyPixelOffsets[index];
  if (stripReversed) pixel = static_cast<int>(kPixelCount) - 1 - pixel;
  return pixel >= 0 && pixel < static_cast<int>(kPixelCount) ? pixel : -1;
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
      if (webClients == 0) clearTargets();
      break;
    case WStype_TEXT:
      handleWebMessage(client, payload, length);
      break;
    default:
      break;
  }
}

void startNetwork() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.setHostname(kHostname);
  WiFi.softAP(kApSsid, kApPassword);
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
