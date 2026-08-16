#pragma once

#include <Arduino.h>
#include <SPI.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>

namespace notefall {

struct Rgb {
  uint8_t r;
  uint8_t g;
  uint8_t b;

  constexpr Rgb(uint8_t red = 0, uint8_t green = 0, uint8_t blue = 0)
      : r(red), g(green), b(blue) {}
};

class Apa102Strip {
 public:
  struct Diagnostics {
    uint32_t framesSent = 0;
    uint32_t unchangedFramesSkipped = 0;
    uint32_t lastTransferUs = 0;
    uint32_t maxTransferUs = 0;
    uint16_t frameBytes = 0;
    uint8_t globalBrightness = 0;
    bool ready = false;
  };

  Apa102Strip(size_t count, uint8_t dataPin, uint8_t clockPin, uint32_t frequencyHz);
  ~Apa102Strip();

  Apa102Strip(const Apa102Strip&) = delete;
  Apa102Strip& operator=(const Apa102Strip&) = delete;

  bool begin();
  void clear();
  void setPixel(size_t index, Rgb color);
  Rgb pixel(size_t index) const;
  // Returns true only when a physical SPI frame was necessary and sent.
  bool show(uint8_t globalBrightness, bool force = false);
  size_t size() const { return count_; }
  Diagnostics diagnostics() const;

 private:
  size_t count_;
  uint8_t dataPin_;
  uint8_t clockPin_;
  uint32_t frequencyHz_;
  size_t endFrameBytes_ = 0;
  size_t frameBytes_ = 0;
  uint8_t* frame_ = nullptr;
  uint8_t* lastFrame_ = nullptr;
  uint8_t lastBrightness_ = 0;
  bool dirty_ = true;
  mutable portMUX_TYPE diagnosticsMux_ = portMUX_INITIALIZER_UNLOCKED;
  Diagnostics diagnostics_;
};

}  // namespace notefall
