#pragma once

#include <Arduino.h>

namespace notefall::app {
constexpr char kFirmwareVersion[] = "0.6.3";
constexpr uint8_t kProtocolVersion = 5;
constexpr char kApSsid[] = "NoteFall-88";
constexpr char kApPassword[] = "notefall88";
constexpr char kHostname[] = "notefall";
constexpr uint16_t kHttpPort = 80;
constexpr uint16_t kWebSocketPort = 81;
constexpr uint32_t kLedRefreshMs = 10;
constexpr uint32_t kStatusBroadcastMs = 1000;
constexpr uint32_t kTestNoteMs = 1800;
constexpr int8_t kMinPixelOffset = -8;
constexpr int8_t kMaxPixelOffset = 8;
}  // namespace notefall::app
