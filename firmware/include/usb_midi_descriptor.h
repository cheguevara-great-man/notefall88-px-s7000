#pragma once

#include <cstddef>
#include <cstdint>

namespace notefall::usb {

enum class DescriptorResult : uint8_t {
  Found,
  NotFound,
  Malformed,
};

struct MidiStreamingInterface {
  uint8_t interfaceNumber = 0;
  uint8_t alternateSetting = 0;
  uint8_t inputEndpointAddress = 0;
  uint8_t outputEndpointAddress = 0;
  uint16_t inputPacketSize = 0;
  uint16_t outputPacketSize = 0;
  std::size_t nextSearchOffset = 0;
};

// Find the next USB Audio/MIDIStreaming interface containing a valid bulk IN
// endpoint. This parser operates on the exact configuration descriptor bytes
// used by ESP-IDF, but is independent of ESP-IDF so malformed and multi-
// interface cases can execute in host CI. OUT is optional because target-light
// feedback only requires piano input; Follow Me degrades explicitly without it.
inline DescriptorResult findMidiStreamingInterface(const uint8_t* bytes,
                                                    std::size_t total,
                                                    std::size_t searchOffset,
                                                    MidiStreamingInterface& found) {
  constexpr uint8_t kInterfaceDescriptor = 0x04;
  constexpr uint8_t kEndpointDescriptor = 0x05;
  constexpr uint8_t kAudioClass = 0x01;
  constexpr uint8_t kMidiStreamingSubclass = 0x03;
  constexpr uint8_t kBulkTransfer = 0x02;
  constexpr uint8_t kDirectionIn = 0x80;

  if (bytes == nullptr || searchOffset > total) return DescriptorResult::Malformed;
  std::size_t offset = searchOffset;
  while (offset < total) {
    if (offset + 2U > total) return DescriptorResult::Malformed;
    const uint8_t length = bytes[offset];
    if (length < 2U || offset + length > total) return DescriptorResult::Malformed;
    const uint8_t type = bytes[offset + 1U];
    if (type != kInterfaceDescriptor) {
      offset += length;
      continue;
    }
    if (length < 9U) return DescriptorResult::Malformed;
    if (bytes[offset + 5U] != kAudioClass || bytes[offset + 6U] != kMidiStreamingSubclass) {
      offset += length;
      continue;
    }

    MidiStreamingInterface candidate;
    candidate.interfaceNumber = bytes[offset + 2U];
    candidate.alternateSetting = bytes[offset + 3U];
    std::size_t cursor = offset + length;
    while (cursor < total) {
      if (cursor + 2U > total) return DescriptorResult::Malformed;
      const uint8_t childLength = bytes[cursor];
      if (childLength < 2U || cursor + childLength > total) {
        return DescriptorResult::Malformed;
      }
      const uint8_t childType = bytes[cursor + 1U];
      if (childType == kInterfaceDescriptor) break;
      if (childType == kEndpointDescriptor) {
        if (childLength < 7U) return DescriptorResult::Malformed;
        const uint8_t endpointAddress = bytes[cursor + 2U];
        const bool bulk = (bytes[cursor + 3U] & 0x03U) == kBulkTransfer;
        const bool endpointNumberValid = (endpointAddress & 0x0FU) != 0;
        const uint16_t packetSize = static_cast<uint16_t>(
            (static_cast<uint16_t>(bytes[cursor + 4U]) |
             (static_cast<uint16_t>(bytes[cursor + 5U]) << 8U)) & 0x07FFU);
        const bool packetSizeValid = packetSize >= 4U && packetSize <= 512U &&
            (packetSize % 4U) == 0;
        if (bulk && endpointNumberValid && packetSizeValid) {
          if ((endpointAddress & kDirectionIn) != 0 && candidate.inputEndpointAddress == 0) {
            candidate.inputEndpointAddress = endpointAddress;
            candidate.inputPacketSize = packetSize;
          } else if ((endpointAddress & kDirectionIn) == 0 &&
                     candidate.outputEndpointAddress == 0) {
            candidate.outputEndpointAddress = endpointAddress;
            candidate.outputPacketSize = packetSize;
          }
        }
      }
      cursor += childLength;
    }
    if (candidate.inputEndpointAddress != 0) {
      candidate.nextSearchOffset = cursor;
      found = candidate;
      return DescriptorResult::Found;
    }
    offset = cursor;
  }
  return DescriptorResult::NotFound;
}

}  // namespace notefall::usb
