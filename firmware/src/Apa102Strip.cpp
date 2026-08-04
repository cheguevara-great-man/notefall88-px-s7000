#include "Apa102Strip.h"

namespace notefall {

Apa102Strip::Apa102Strip(size_t count, uint8_t dataPin, uint8_t clockPin, uint32_t frequencyHz)
    : count_(count), dataPin_(dataPin), clockPin_(clockPin), frequencyHz_(frequencyHz) {}

Apa102Strip::~Apa102Strip() { delete[] pixels_; }

bool Apa102Strip::begin() {
  pixels_ = new (std::nothrow) Rgb[count_];
  if (pixels_ == nullptr) return false;
  SPI.begin(clockPin_, -1, dataPin_, -1);
  clear();
  show(1);
  return true;
}

void Apa102Strip::clear() {
  if (pixels_ == nullptr) return;
  std::fill(pixels_, pixels_ + count_, Rgb{});
}

void Apa102Strip::setPixel(size_t index, Rgb color) {
  if (pixels_ != nullptr && index < count_) pixels_[index] = color;
}

Rgb Apa102Strip::pixel(size_t index) const {
  return pixels_ != nullptr && index < count_ ? pixels_[index] : Rgb{};
}

void Apa102Strip::show(uint8_t globalBrightness) {
  if (pixels_ == nullptr) return;
  if (globalBrightness < 1) globalBrightness = 1;
  if (globalBrightness > 31) globalBrightness = 31;
  SPI.beginTransaction(SPISettings(frequencyHz_, MSBFIRST, SPI_MODE0));
  for (int index = 0; index < 4; ++index) SPI.transfer(0x00);
  for (size_t index = 0; index < count_; ++index) {
    const Rgb color = pixels_[index];
    SPI.transfer(static_cast<uint8_t>(0xE0U | globalBrightness));
    SPI.transfer(color.b);
    SPI.transfer(color.g);
    SPI.transfer(color.r);
  }
  const size_t endBytes = std::max<size_t>(4, (count_ + 15U) / 16U);
  for (size_t index = 0; index < endBytes; ++index) SPI.transfer(0xFF);
  SPI.endTransaction();
}

}  // namespace notefall
