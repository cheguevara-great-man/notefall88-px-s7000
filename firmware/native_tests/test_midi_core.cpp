#include "apa102_core.h"
#include "midi_core.h"
#include "layout_generated.h"
#include "realtime_core.h"
#include "usb_midi_descriptor.h"

#include <array>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <vector>

namespace {

int failures = 0;

#define CHECK(expression)                                                        \
  do {                                                                           \
    if (!(expression)) {                                                         \
      std::cerr << __FILE__ << ':' << __LINE__ << ": CHECK failed: "           \
                << #expression << '\n';                                          \
      ++failures;                                                                \
    }                                                                            \
  } while (false)

void testDecode() {
  using notefall::midi::DecodedMessage;
  using notefall::midi::MessageKind;
  DecodedMessage decoded;
  const uint8_t noteOn[4]{0x09, 0x92, 60, 100};
  CHECK(notefall::midi::decodeUsbEventPacket(noteOn, decoded));
  CHECK(decoded.kind == MessageKind::NoteOn);
  CHECK(decoded.channel == 3);
  CHECK(decoded.data1 == 60 && decoded.data2 == 100);

  const uint8_t zeroVelocity[4]{0x09, 0x90, 60, 0};
  CHECK(notefall::midi::decodeUsbEventPacket(zeroVelocity, decoded));
  CHECK(decoded.kind == MessageKind::NoteOff);

  const uint8_t wrongCin[4]{0x08, 0x90, 60, 100};
  const uint8_t badData[4]{0x09, 0x90, 128, 100};
  const uint8_t realtime[4]{0x0F, 0xF8, 0, 0};
  const uint8_t sysex[4]{0x04, 0xF0, 0x7E, 0x7F};
  const uint8_t malformedRealtime[4]{0x0F, 0x90, 60, 100};
  CHECK(!notefall::midi::decodeUsbEventPacket(wrongCin, decoded));
  CHECK(!notefall::midi::decodeUsbEventPacket(badData, decoded));
  CHECK(notefall::midi::classifyUsbEventPacket(realtime, decoded) ==
        notefall::midi::PacketResult::UnsupportedSystem);
  CHECK(notefall::midi::classifyUsbEventPacket(sysex, decoded) ==
        notefall::midi::PacketResult::UnsupportedSystem);
  CHECK(notefall::midi::classifyUsbEventPacket(malformedRealtime, decoded) ==
        notefall::midi::PacketResult::Malformed);
  CHECK(!notefall::midi::decodeUsbEventPacket(nullptr, decoded));
}

void testEncode() {
  uint8_t packet[4]{};
  CHECK(notefall::midi::encodeUsbEventPacket(0xB7, 64, 127, packet));
  CHECK(packet[0] == 0x0B && packet[1] == 0xB7 && packet[2] == 64 && packet[3] == 127);
  CHECK(notefall::midi::encodeUsbEventPacket(0xC2, 9, 127, packet));
  CHECK(packet[0] == 0x0C && packet[1] == 0xC2 && packet[2] == 9 && packet[3] == 0);
  CHECK(!notefall::midi::encodeUsbEventPacket(0xF8, 0, 0, packet));
  CHECK(!notefall::midi::encodeUsbEventPacket(0x90, 128, 0, packet));
  CHECK(!notefall::midi::encodeUsbEventPacket(0x90, 60, 1, nullptr));

  for (uint16_t command = 0x80; command <= 0xE0; command += 0x10) {
    for (uint16_t channel = 0; channel < 16; ++channel) {
      for (const uint8_t data : {uint8_t{0}, uint8_t{1}, uint8_t{127}}) {
        const uint8_t status = static_cast<uint8_t>(command | channel);
        CHECK(notefall::midi::encodeUsbEventPacket(status, data, data, packet));
        notefall::midi::DecodedMessage decoded;
        CHECK(notefall::midi::decodeUsbEventPacket(packet, decoded));
        CHECK(decoded.status == status && decoded.data1 == data);
        CHECK(decoded.data2 == ((command == 0xC0 || command == 0xD0) ? 0 : data));
      }
    }
  }
}

void testHighResolutionVelocity() {
  notefall::midi::HighResolutionVelocityTracker tracker;
  CHECK(!tracker.consumeForNote(1, 64).valid);
  tracker.observeControl(1, 88, 5);
  tracker.observeControl(2, 88, 9);
  const auto channel2 = tracker.consumeForNote(2, 100);
  CHECK(channel2.valid && channel2.value == ((100U << 7U) | 9U));
  const auto channel1 = tracker.consumeForNote(1, 64);
  CHECK(channel1.valid && channel1.value == ((64U << 7U) | 5U));
  CHECK(!tracker.consumeForNote(1, 64).valid);
  tracker.observeControl(1, 87, 99);
  CHECK(!tracker.consumeForNote(1, 64).valid);
  tracker.observeControl(16, 88, 127);
  tracker.clear();
  CHECK(!tracker.consumeForNote(16, 127).valid);
}

void testTimeRollover() {
  using notefall::midi::timeReached;
  CHECK(!timeReached(999, 1000));
  CHECK(timeReached(1000, 1000));
  CHECK(timeReached(1001, 1000));
  CHECK(!timeReached(0xFFFFFFF0U, 0x00000010U));
  CHECK(timeReached(0x00000010U, 0xFFFFFFF0U));
}

void testPixelMapping() {
  constexpr std::array<uint16_t, 3> pixels{0, 4, 9};
  constexpr std::array<int8_t, 3> offsets{0, -1, 1};
  using notefall::midi::mapPixel;
  CHECK(mapPixel(21, 21, 23, 10, pixels.data(), offsets.data(), 0, false) == 0);
  CHECK(mapPixel(22, 21, 23, 10, pixels.data(), offsets.data(), 1, false) == 4);
  CHECK(mapPixel(21, 21, 23, 10, pixels.data(), offsets.data(), 0, true) == 9);
  CHECK(mapPixel(22, 21, 23, 10, pixels.data(), offsets.data(), 0, true) == 6);
  CHECK(mapPixel(20, 21, 23, 10, pixels.data(), offsets.data(), 0, false) == -1);
  CHECK(mapPixel(23, 21, 23, 10, pixels.data(), offsets.data(), 1, false) == -1);
  CHECK(mapPixel(21, 21, 23, 10, nullptr, offsets.data(), 0, false) == -1);

  std::array<int8_t, notefall::layout::kNoteCount> realOffsets{};
  std::array<bool, notefall::layout::kPixelCount> seen{};
  for (uint8_t note = notefall::layout::kFirstMidiNote;
       note <= notefall::layout::kLastMidiNote; ++note) {
    const int normal = mapPixel(
        note, notefall::layout::kFirstMidiNote, notefall::layout::kLastMidiNote,
        notefall::layout::kPixelCount, notefall::layout::kPixelByNote,
        realOffsets.data(), 0, false);
    const int reversed = mapPixel(
        note, notefall::layout::kFirstMidiNote, notefall::layout::kLastMidiNote,
        notefall::layout::kPixelCount, notefall::layout::kPixelByNote,
        realOffsets.data(), 0, true);
    CHECK(normal >= 0 && normal < static_cast<int>(notefall::layout::kPixelCount));
    CHECK(reversed == static_cast<int>(notefall::layout::kPixelCount) - 1 - normal);
    CHECK(!seen[static_cast<std::size_t>(normal)]);
    seen[static_cast<std::size_t>(normal)] = true;
  }
}

void testRealtimeFixedQueue() {
  notefall::realtime::FixedQueue<int, 3> queue;
  CHECK(queue.empty());
  CHECK(queue.capacity() == 3);
  CHECK(queue.push(10));
  CHECK(queue.push(20));
  CHECK(queue.push(30));
  CHECK(queue.full());
  CHECK(!queue.push(40));
  int value = 0;
  CHECK(queue.pop(value) && value == 10);
  CHECK(queue.push(40));
  CHECK(queue.pop(value) && value == 20);
  CHECK(queue.pop(value) && value == 30);
  CHECK(queue.pop(value) && value == 40);
  CHECK(!queue.pop(value));
  CHECK(queue.push(50));
  queue.clear();
  CHECK(queue.empty() && queue.size() == 0);
}

void testLatencyAccumulator() {
  notefall::realtime::LatencyAccumulator latency;
  auto snapshot = latency.snapshot();
  CHECK(snapshot.samples == 0 && snapshot.averageUs == 0);
  latency.observe(100);
  latency.observe(300);
  snapshot = latency.snapshot();
  CHECK(snapshot.samples == 2);
  CHECK(snapshot.lastUs == 300);
  CHECK(snapshot.maxUs == 300);
  CHECK(snapshot.averageUs == 200);
  latency.observe(static_cast<uint64_t>(UINT32_MAX) + 42U);
  snapshot = latency.snapshot();
  CHECK(snapshot.lastUs == UINT32_MAX);
  CHECK(snapshot.maxUs == UINT32_MAX);
}

void testApa102WireFormat() {
  using namespace notefall::apa102;
  CHECK(endFrameBytes(1) == 4);
  CHECK(endFrameBytes(64) == 4);
  CHECK(endFrameBytes(65) == 5);
  CHECK(endFrameBytes(176) == 11);
  CHECK(frameBytes(176) == 719);
  CHECK(clampBrightness(0) == 1);
  CHECK(clampBrightness(4) == 4);
  CHECK(clampBrightness(255) == 31);
  CHECK(controlByte(0) == 0xE1);
  CHECK(controlByte(4) == 0xE4);
  CHECK(controlByte(31) == 0xFF);
}

void append(std::vector<uint8_t>& target, std::initializer_list<uint8_t> bytes) {
  target.insert(target.end(), bytes.begin(), bytes.end());
}

void appendMidiInterface(std::vector<uint8_t>& descriptor, uint8_t number, uint8_t alternate,
                         bool input, bool output, uint16_t packetSize = 64) {
  append(descriptor, {9, 4, number, alternate, static_cast<uint8_t>((input ? 1 : 0) +
      (output ? 1 : 0)), 1, 3, 0, 0});
  append(descriptor, {7, 0x24, 1, 0, 1, 0, 0});
  if (output) {
    append(descriptor, {9, 5, 0x02, 2, static_cast<uint8_t>(packetSize & 0xFFU),
                        static_cast<uint8_t>(packetSize >> 8U), 0, 0, 0});
  }
  if (input) {
    append(descriptor, {9, 5, 0x81, 2, static_cast<uint8_t>(packetSize & 0xFFU),
                        static_cast<uint8_t>(packetSize >> 8U), 0, 0, 0});
  }
}

void testUsbDescriptorSelection() {
  using notefall::usb::DescriptorResult;
  using notefall::usb::MidiStreamingInterface;
  std::vector<uint8_t> descriptor{9, 2, 0, 0, 1, 1, 0, 0x80, 50};
  // A non-MIDI Audio Control interface and interrupt endpoint must be ignored.
  append(descriptor, {9, 4, 0, 0, 1, 1, 1, 0, 0});
  append(descriptor, {7, 5, 0x83, 3, 8, 0, 1});
  appendMidiInterface(descriptor, 2, 1, true, true);
  MidiStreamingInterface found;
  CHECK(notefall::usb::findMidiStreamingInterface(
      descriptor.data(), descriptor.size(), 0, found) == DescriptorResult::Found);
  CHECK(found.interfaceNumber == 2 && found.alternateSetting == 1);
  CHECK(found.inputEndpointAddress == 0x81 && found.inputPacketSize == 64);
  CHECK(found.outputEndpointAddress == 0x02 && found.outputPacketSize == 64);
  CHECK(found.nextSearchOffset == descriptor.size());

  std::vector<uint8_t> inputOnly{9, 2, 0, 0, 1, 1, 0, 0x80, 50};
  appendMidiInterface(inputOnly, 3, 0, true, false, 512);
  CHECK(notefall::usb::findMidiStreamingInterface(
      inputOnly.data(), inputOnly.size(), 0, found) == DescriptorResult::Found);
  CHECK(found.inputPacketSize == 512 && found.outputEndpointAddress == 0);

  // Search continuation supports trying another alternate/interface when an
  // ESP-IDF claim of the first valid candidate fails.
  std::vector<uint8_t> multiple{9, 2, 0, 0, 2, 1, 0, 0x80, 50};
  appendMidiInterface(multiple, 4, 0, true, false);
  appendMidiInterface(multiple, 5, 0, true, true);
  CHECK(notefall::usb::findMidiStreamingInterface(
      multiple.data(), multiple.size(), 0, found) == DescriptorResult::Found);
  CHECK(found.interfaceNumber == 4);
  const std::size_t next = found.nextSearchOffset;
  CHECK(notefall::usb::findMidiStreamingInterface(
      multiple.data(), multiple.size(), next, found) == DescriptorResult::Found);
  CHECK(found.interfaceNumber == 5 && found.outputEndpointAddress == 0x02);
}

void testUsbDescriptorFailures() {
  using notefall::usb::DescriptorResult;
  notefall::usb::MidiStreamingInterface found;
  const std::vector<uint8_t> zeroLength{9, 2, 0, 0, 1, 1, 0, 0x80, 50, 0, 4};
  CHECK(notefall::usb::findMidiStreamingInterface(
      zeroLength.data(), zeroLength.size(), 0, found) == DescriptorResult::Malformed);
  const std::vector<uint8_t> truncated{9, 4, 1, 0, 1, 1, 3, 0, 0,
                                       9, 5, 0x81, 2, 64, 0, 0};
  CHECK(notefall::usb::findMidiStreamingInterface(
      truncated.data(), truncated.size(), 0, found) == DescriptorResult::Malformed);

  // Endpoint zero, interrupt endpoints and impossible packet sizes are not
  // accepted as MIDI bulk IN endpoints, but a structurally valid descriptor
  // remains NotFound rather than Malformed.
  for (const std::array<uint8_t, 7>& endpoint : {
      std::array<uint8_t, 7>{7, 5, 0x80, 2, 64, 0, 0},
      std::array<uint8_t, 7>{7, 5, 0x81, 3, 64, 0, 0},
      std::array<uint8_t, 7>{7, 5, 0x81, 2, 2, 0, 0},
      std::array<uint8_t, 7>{7, 5, 0x81, 2, 63, 0, 0},
  }) {
    std::vector<uint8_t> invalid{9, 4, 1, 0, 1, 1, 3, 0, 0};
    invalid.insert(invalid.end(), endpoint.begin(), endpoint.end());
    CHECK(notefall::usb::findMidiStreamingInterface(
        invalid.data(), invalid.size(), 0, found) == DescriptorResult::NotFound);
  }
  CHECK(notefall::usb::findMidiStreamingInterface(nullptr, 0, 0, found) ==
        DescriptorResult::Malformed);
}

}  // namespace

int main() {
  testDecode();
  testEncode();
  testHighResolutionVelocity();
  testTimeRollover();
  testPixelMapping();
  testRealtimeFixedQueue();
  testLatencyAccumulator();
  testApa102WireFormat();
  testUsbDescriptorSelection();
  testUsbDescriptorFailures();
  if (failures != 0) return EXIT_FAILURE;
  std::cout << "firmware native core: all checks passed\n";
  return EXIT_SUCCESS;
}
