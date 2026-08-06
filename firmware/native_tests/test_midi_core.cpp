#include "midi_core.h"
#include "layout_generated.h"

#include <array>
#include <cstdint>
#include <cstdlib>
#include <iostream>

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

}  // namespace

int main() {
  testDecode();
  testEncode();
  testHighResolutionVelocity();
  testTimeRollover();
  testPixelMapping();
  if (failures != 0) return EXIT_FAILURE;
  std::cout << "firmware native core: all checks passed\n";
  return EXIT_SUCCESS;
}
