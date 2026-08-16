#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace notefall::realtime {

// Fixed-capacity storage for cross-task queues. Callers provide the platform
// lock so the same implementation remains executable in native tests and does
// not allocate after boot on the ESP32.
template <typename T, std::size_t Capacity>
class FixedQueue {
 public:
  static_assert(Capacity > 0, "FixedQueue capacity must be positive");

  bool push(const T& value) {
    if (size_ == Capacity) return false;
    entries_[head_] = value;
    head_ = (head_ + 1U) % Capacity;
    ++size_;
    return true;
  }

  bool pop(T& value) {
    if (size_ == 0) return false;
    value = entries_[tail_];
    tail_ = (tail_ + 1U) % Capacity;
    --size_;
    return true;
  }

  void clear() {
    head_ = 0;
    tail_ = 0;
    size_ = 0;
  }

  constexpr std::size_t capacity() const { return Capacity; }
  std::size_t size() const { return size_; }
  bool empty() const { return size_ == 0; }
  bool full() const { return size_ == Capacity; }

 private:
  std::array<T, Capacity> entries_{};
  std::size_t head_ = 0;
  std::size_t tail_ = 0;
  std::size_t size_ = 0;
};

struct LatencySnapshot {
  uint32_t lastUs = 0;
  uint32_t maxUs = 0;
  uint32_t averageUs = 0;
  uint32_t samples = 0;
};

// A saturating accumulator avoids a months-long installation wrapping the
// sum and suddenly reporting deceptively small latency.
class LatencyAccumulator {
 public:
  void observe(uint64_t elapsedUs) {
    const uint32_t bounded = elapsedUs > UINT32_MAX
        ? UINT32_MAX
        : static_cast<uint32_t>(elapsedUs);
    lastUs_ = bounded;
    if (bounded > maxUs_) maxUs_ = bounded;
    if (samples_ == UINT32_MAX || UINT64_MAX - totalUs_ < bounded) {
      // Preserve the average approximately while making room for new samples.
      totalUs_ /= 2U;
      samples_ /= 2U;
    }
    totalUs_ += bounded;
    ++samples_;
  }

  LatencySnapshot snapshot() const {
    LatencySnapshot result;
    result.lastUs = lastUs_;
    result.maxUs = maxUs_;
    result.samples = samples_;
    result.averageUs = samples_ == 0
        ? 0
        : static_cast<uint32_t>(totalUs_ / samples_);
    return result;
  }

 private:
  uint64_t totalUs_ = 0;
  uint32_t lastUs_ = 0;
  uint32_t maxUs_ = 0;
  uint32_t samples_ = 0;
};

}  // namespace notefall::realtime
