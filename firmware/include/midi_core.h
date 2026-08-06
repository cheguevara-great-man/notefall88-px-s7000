#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace notefall::midi {

enum class MessageKind : uint8_t {
  OtherChannelVoice,
  NoteOff,
  NoteOn,
  ControlChange,
};

struct DecodedMessage {
  MessageKind kind = MessageKind::OtherChannelVoice;
  uint8_t status = 0;
  uint8_t command = 0;
  uint8_t channel = 1;
  uint8_t data1 = 0;
  uint8_t data2 = 0;
};

enum class PacketResult : uint8_t {
  ChannelVoice,
  UnsupportedSystem,
  Malformed,
};

// Decode one USB-MIDI 1.0 event packet. NoteFall intentionally accepts only
// channel-voice messages here: the real-time key path has no need to allocate
// or reassemble SysEx, and malformed CIN/status combinations fail closed.
inline PacketResult classifyUsbEventPacket(const uint8_t packet[4], DecodedMessage& decoded) {
  if (packet == nullptr) return PacketResult::Malformed;
  const uint8_t cin = static_cast<uint8_t>(packet[0] & 0x0FU);
  const uint8_t status = packet[1];
  const uint8_t command = static_cast<uint8_t>(status & 0xF0U);
  if (cin < 0x08U) {
    // CIN 2..7 are valid System Common/SysEx packet shapes. NoteFall does not
    // reassemble them, but they must not appear as USB corruption diagnostics.
    return cin >= 0x02U ? PacketResult::UnsupportedSystem : PacketResult::Malformed;
  }
  if (cin == 0x0FU) {
    return status >= 0xF8U ? PacketResult::UnsupportedSystem : PacketResult::Malformed;
  }
  if (command < 0x80U || command > 0xE0U || cin != (command >> 4U)) {
    return PacketResult::Malformed;
  }
  if (packet[2] > 0x7FU || packet[3] > 0x7FU) return PacketResult::Malformed;

  decoded.status = status;
  decoded.command = command;
  decoded.channel = static_cast<uint8_t>((status & 0x0FU) + 1U);
  decoded.data1 = packet[2];
  decoded.data2 = packet[3];
  if (command == 0x80U || (command == 0x90U && packet[3] == 0)) {
    decoded.kind = MessageKind::NoteOff;
  } else if (command == 0x90U) {
    decoded.kind = MessageKind::NoteOn;
  } else if (command == 0xB0U) {
    decoded.kind = MessageKind::ControlChange;
  } else {
    decoded.kind = MessageKind::OtherChannelVoice;
  }
  return PacketResult::ChannelVoice;
}

inline bool decodeUsbEventPacket(const uint8_t packet[4], DecodedMessage& decoded) {
  return classifyUsbEventPacket(packet, decoded) == PacketResult::ChannelVoice;
}

inline bool encodeUsbEventPacket(uint8_t status, uint8_t data1, uint8_t data2,
                                 uint8_t packet[4]) {
  if (packet == nullptr || (status & 0x80U) == 0 || data1 > 0x7FU || data2 > 0x7FU) {
    return false;
  }
  const uint8_t command = static_cast<uint8_t>(status & 0xF0U);
  if (command < 0x80U || command > 0xE0U) return false;
  packet[0] = static_cast<uint8_t>(command >> 4U);
  packet[1] = status;
  packet[2] = data1;
  packet[3] = (command == 0xC0U || command == 0xD0U) ? 0 : data2;
  return true;
}

struct HighResolutionVelocity {
  bool valid = false;
  uint16_t value = 0;
};

class HighResolutionVelocityTracker {
 public:
  void observeControl(uint8_t channel, uint8_t controller, uint8_t value) {
    if (channel < 1 || channel > 16 || controller != 88 || value > 0x7FU) return;
    const std::size_t index = static_cast<std::size_t>(channel - 1U);
    lsb_[index] = value;
    valid_[index] = true;
  }

  HighResolutionVelocity consumeForNote(uint8_t channel, uint8_t velocity) {
    if (channel < 1 || channel > 16 || velocity > 0x7FU) return {};
    const std::size_t index = static_cast<std::size_t>(channel - 1U);
    if (!valid_[index]) return HighResolutionVelocity{};
    valid_[index] = false;
    HighResolutionVelocity result;
    result.valid = true;
    result.value = static_cast<uint16_t>(
        (static_cast<uint16_t>(velocity) << 7U) | lsb_[index]);
    return result;
  }

  void clear() {
    lsb_.fill(0);
    valid_.fill(false);
  }

 private:
  std::array<uint8_t, 16> lsb_{};
  std::array<bool, 16> valid_{};
};

// Correct across the uint32_t millis() rollover as long as deadlines are less
// than 2^31 ms into the future (all NoteFall deadlines are at most 60 s).
inline bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

inline int mapPixel(uint8_t note, uint8_t firstNote, uint8_t lastNote,
                    std::size_t pixelCount, const uint16_t* basePixels,
                    const int8_t* perKeyOffsets, int globalOffset, bool reversed) {
  if (basePixels == nullptr || perKeyOffsets == nullptr || note < firstNote || note > lastNote) {
    return -1;
  }
  const std::size_t index = static_cast<std::size_t>(note - firstNote);
  int pixel = static_cast<int>(basePixels[index]) + globalOffset + perKeyOffsets[index];
  if (reversed) pixel = static_cast<int>(pixelCount) - 1 - pixel;
  return pixel >= 0 && pixel < static_cast<int>(pixelCount) ? pixel : -1;
}

}  // namespace notefall::midi
