#pragma once

#include <cstddef>
#include <cstdint>

namespace notefall::apa102 {

constexpr uint8_t clampBrightness(uint8_t brightness) {
  return brightness < 1U ? 1U : (brightness > 31U ? 31U : brightness);
}

constexpr uint8_t controlByte(uint8_t brightness) {
  return static_cast<uint8_t>(0xE0U | clampBrightness(brightness));
}

constexpr std::size_t endFrameBytes(std::size_t pixelCount) {
  return ((pixelCount + 15U) / 16U) < 4U
      ? 4U
      : ((pixelCount + 15U) / 16U);
}

constexpr std::size_t frameBytes(std::size_t pixelCount) {
  return 4U + pixelCount * 4U + endFrameBytes(pixelCount);
}

static_assert(frameBytes(176) == 719);
static_assert(controlByte(4) == 0xE4U);

}  // namespace notefall::apa102
