#pragma once

#include <Arduino.h>
#include <SPI.h>

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
  Apa102Strip(size_t count, uint8_t dataPin, uint8_t clockPin, uint32_t frequencyHz);
  ~Apa102Strip();

  Apa102Strip(const Apa102Strip&) = delete;
  Apa102Strip& operator=(const Apa102Strip&) = delete;

  bool begin();
  void clear();
  void setPixel(size_t index, Rgb color);
  Rgb pixel(size_t index) const;
  void show(uint8_t globalBrightness);
  size_t size() const { return count_; }

 private:
  size_t count_;
  uint8_t dataPin_;
  uint8_t clockPin_;
  uint32_t frequencyHz_;
  Rgb* pixels_ = nullptr;
};

}  // namespace notefall
