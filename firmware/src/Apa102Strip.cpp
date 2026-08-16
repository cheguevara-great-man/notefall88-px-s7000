#include "Apa102Strip.h"

#include <algorithm>
#include <cstring>
#include <esp_timer.h>
#include <new>

#include "apa102_core.h"

namespace notefall {

Apa102Strip::Apa102Strip(size_t count, uint8_t dataPin, uint8_t clockPin, uint32_t frequencyHz)
    : count_(count), dataPin_(dataPin), clockPin_(clockPin), frequencyHz_(frequencyHz) {}

Apa102Strip::~Apa102Strip() {
  delete[] frame_;
  delete[] lastFrame_;
}

bool Apa102Strip::begin() {
  if (frame_ != nullptr) return true;
  endFrameBytes_ = apa102::endFrameBytes(count_);
  frameBytes_ = apa102::frameBytes(count_);
  frame_ = new (std::nothrow) uint8_t[frameBytes_];
  lastFrame_ = new (std::nothrow) uint8_t[frameBytes_];
  if (frame_ == nullptr || lastFrame_ == nullptr) {
    delete[] frame_;
    delete[] lastFrame_;
    frame_ = nullptr;
    lastFrame_ = nullptr;
    return false;
  }
  std::memset(frame_, 0, frameBytes_);
  std::memset(lastFrame_, 0, frameBytes_);
  std::memset(frame_ + 4U + count_ * 4U, 0xFF, endFrameBytes_);
  SPI.begin(clockPin_, -1, dataPin_, -1);
  clear();
  dirty_ = true;
  show(1, true);
  portENTER_CRITICAL(&diagnosticsMux_);
  diagnostics_.ready = true;
  diagnostics_.frameBytes = static_cast<uint16_t>(
      std::min<size_t>(frameBytes_, UINT16_MAX));
  portEXIT_CRITICAL(&diagnosticsMux_);
  return true;
}

void Apa102Strip::clear() {
  if (frame_ == nullptr) return;
  for (size_t index = 0; index < count_; ++index) setPixel(index, Rgb{});
}

void Apa102Strip::setPixel(size_t index, Rgb color) {
  if (frame_ == nullptr || index >= count_) return;
  uint8_t* pixel = frame_ + 4U + index * 4U;
  if (pixel[1] == color.b && pixel[2] == color.g && pixel[3] == color.r) return;
  pixel[1] = color.b;
  pixel[2] = color.g;
  pixel[3] = color.r;
  dirty_ = true;
}

Rgb Apa102Strip::pixel(size_t index) const {
  if (frame_ == nullptr || index >= count_) return Rgb{};
  const uint8_t* pixel = frame_ + 4U + index * 4U;
  return Rgb{pixel[3], pixel[2], pixel[1]};
}

bool Apa102Strip::show(uint8_t globalBrightness, bool force) {
  if (frame_ == nullptr) return false;
  globalBrightness = apa102::clampBrightness(globalBrightness);
  if (globalBrightness != lastBrightness_) {
    for (size_t index = 0; index < count_; ++index) {
      frame_[4U + index * 4U] = apa102::controlByte(globalBrightness);
    }
    lastBrightness_ = globalBrightness;
    dirty_ = true;
  }
  if (!dirty_ && !force) {
    portENTER_CRITICAL(&diagnosticsMux_);
    ++diagnostics_.unchangedFramesSkipped;
    portEXIT_CRITICAL(&diagnosticsMux_);
    return false;
  }
  if (!force && std::memcmp(frame_, lastFrame_, frameBytes_) == 0) {
    dirty_ = false;
    portENTER_CRITICAL(&diagnosticsMux_);
    ++diagnostics_.unchangedFramesSkipped;
    portEXIT_CRITICAL(&diagnosticsMux_);
    return false;
  }

  const int64_t startedUs = esp_timer_get_time();
  SPI.beginTransaction(SPISettings(frequencyHz_, MSBFIRST, SPI_MODE0));
  // One bulk operation lets Arduino-ESP32 use the hardware SPI transaction
  // path instead of paying a function call and lock cost for every byte.
  SPI.writeBytes(frame_, static_cast<uint32_t>(frameBytes_));
  SPI.endTransaction();
  const uint32_t elapsedUs = static_cast<uint32_t>(
      std::min<int64_t>(std::max<int64_t>(0, esp_timer_get_time() - startedUs), UINT32_MAX));
  dirty_ = false;
  std::memcpy(lastFrame_, frame_, frameBytes_);
  portENTER_CRITICAL(&diagnosticsMux_);
  ++diagnostics_.framesSent;
  diagnostics_.lastTransferUs = elapsedUs;
  diagnostics_.maxTransferUs = std::max(diagnostics_.maxTransferUs, elapsedUs);
  diagnostics_.globalBrightness = globalBrightness;
  portEXIT_CRITICAL(&diagnosticsMux_);
  return true;
}

Apa102Strip::Diagnostics Apa102Strip::diagnostics() const {
  portENTER_CRITICAL(&diagnosticsMux_);
  const Diagnostics snapshot = diagnostics_;
  portEXIT_CRITICAL(&diagnosticsMux_);
  return snapshot;
}

}  // namespace notefall
