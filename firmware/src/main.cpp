#include <Arduino.h>
#include <SPI.h>

#include "layout_generated.h"

namespace {

using namespace notefall::layout;

constexpr uint8_t kMagic0 = 'N';
constexpr uint8_t kMagic1 = 'F';
constexpr uint8_t kProtocolVersion = 1;
constexpr uint8_t kFrameMessage = 0x10;
constexpr size_t kFramePayloadSize = 4 + static_cast<size_t>(kRows) * kNotes * 3;
constexpr size_t kMaxPayload = 2048;

struct Rgb {
  uint8_t r;
  uint8_t g;
  uint8_t b;

  Rgb() : r(0), g(0), b(0) {}
  Rgb(uint8_t red, uint8_t green, uint8_t blue) : r(red), g(green), b(blue) {}
};

Rgb pixels[kPixelCount];
uint8_t payload[kMaxPayload];
uint8_t activeBrightness = 1;
uint32_t lastValidFrameMs = 0;
bool outputIsBlank = true;

uint16_t crc16Update(uint16_t crc, uint8_t value) {
  crc ^= static_cast<uint16_t>(value) << 8;
  for (uint8_t bit = 0; bit < 8; ++bit) {
    crc = (crc & 0x8000U) ? static_cast<uint16_t>((crc << 1U) ^ 0x1021U)
                          : static_cast<uint16_t>(crc << 1U);
  }
  return crc;
}

void clearPixels() {
  for (auto &pixel : pixels) {
    pixel = Rgb{};
  }
}

void showPixels() {
  SPI.beginTransaction(SPISettings(kSpiHz, MSBFIRST, SPI_MODE0));
  for (uint8_t i = 0; i < 4; ++i) {
    SPI.transfer(0x00);
  }
  const uint8_t brightness = min(activeBrightness, kMaxGlobalBrightness);
  for (const auto &pixel : pixels) {
    SPI.transfer(static_cast<uint8_t>(0xE0U | brightness));
    SPI.transfer(pixel.b);
    SPI.transfer(pixel.g);
    SPI.transfer(pixel.r);
  }
  // Four bytes is conservative for the 96-pixel V0 and compatible with both
  // common APA102C/SK9822 strip latch behavior at the configured low clock rate.
  const size_t endBytes = max<size_t>(4, (kPixelCount + 15U) / 16U);
  for (size_t i = 0; i < endBytes; ++i) {
    SPI.transfer(0xFF);
  }
  SPI.endTransaction();
}

bool applyFrame(const uint8_t *data, size_t length) {
  if (length != kFramePayloadSize) {
    return false;
  }
  const uint8_t rows = data[1];
  const uint8_t notes = data[2];
  if (rows != kRows || notes != kNotes || data[3] != 0) {
    return false;
  }
  activeBrightness = min(data[0], kMaxGlobalBrightness);
  clearPixels();
  bool anyLit = false;
  size_t offset = 4;
  for (uint8_t row = 0; row < kRows; ++row) {
    for (uint8_t note = 0; note < kNotes; ++note) {
      const Rgb color{data[offset], data[offset + 1], data[offset + 2]};
      offset += 3;
      pixels[kPixelByRowNote[row][note]] = color;
      anyLit = anyLit || color.r || color.g || color.b;
    }
  }
  showPixels();
  outputIsBlank = !anyLit;
  lastValidFrameMs = millis();
  return true;
}

enum class RxState : uint8_t { Magic0, Magic1, Header, Payload, CrcLow, CrcHigh };

class PacketReceiver {
 public:
  void consume(uint8_t value) {
    switch (state_) {
      case RxState::Magic0:
        if (value == kMagic0) state_ = RxState::Magic1;
        break;
      case RxState::Magic1:
        if (value == kMagic1) {
          state_ = RxState::Header;
          headerAt_ = 0;
          crc_ = 0xFFFFU;
        } else {
          state_ = value == kMagic0 ? RxState::Magic1 : RxState::Magic0;
        }
        break;
      case RxState::Header:
        header_[headerAt_++] = value;
        crc_ = crc16Update(crc_, value);
        if (headerAt_ == sizeof(header_)) {
          payloadLength_ = static_cast<uint16_t>(header_[2]) |
                           (static_cast<uint16_t>(header_[3]) << 8U);
          if (header_[0] != kProtocolVersion || payloadLength_ > kMaxPayload) {
            reset();
          } else {
            payloadAt_ = 0;
            state_ = payloadLength_ == 0 ? RxState::CrcLow : RxState::Payload;
          }
        }
        break;
      case RxState::Payload:
        payload[payloadAt_++] = value;
        crc_ = crc16Update(crc_, value);
        if (payloadAt_ == payloadLength_) state_ = RxState::CrcLow;
        break;
      case RxState::CrcLow:
        receivedCrc_ = value;
        state_ = RxState::CrcHigh;
        break;
      case RxState::CrcHigh:
        receivedCrc_ |= static_cast<uint16_t>(value) << 8U;
        if (receivedCrc_ == crc_ && header_[1] == kFrameMessage) {
          applyFrame(payload, payloadLength_);
        }
        reset();
        break;
    }
  }

 private:
  void reset() {
    state_ = RxState::Magic0;
    headerAt_ = 0;
    payloadAt_ = 0;
    payloadLength_ = 0;
  }

  RxState state_ = RxState::Magic0;
  uint8_t header_[6]{};  // version, type, length LE, sequence LE
  size_t headerAt_ = 0;
  size_t payloadAt_ = 0;
  uint16_t payloadLength_ = 0;
  uint16_t crc_ = 0xFFFFU;
  uint16_t receivedCrc_ = 0;
};

PacketReceiver receiver;

}  // namespace

void setup() {
  clearPixels();
  SPI.begin(kClockPin, -1, kDataPin, -1);
  showPixels();
  Serial.begin(921600);
  lastValidFrameMs = millis();
}

void loop() {
  while (Serial.available() > 0) {
    receiver.consume(static_cast<uint8_t>(Serial.read()));
  }
  if (!outputIsBlank && millis() - lastValidFrameMs > kFailsafeMs) {
    clearPixels();
    activeBrightness = 1;
    showPixels();
    outputIsBlank = true;
  }
  delay(1);
}
