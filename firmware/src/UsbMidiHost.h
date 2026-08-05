#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/task.h>
#include <usb/usb_host.h>

namespace notefall {

// USB-MIDI 1.0 host transport for ESP32-S3.
// Architecture derived from ESP32_Host_MIDI v7.2.0 (MIT), reduced to the
// single input transport used by NoteFall 88 and with one outstanding IN
// transfer at a time. See THIRD_PARTY_NOTICES.md.
class UsbMidiHost {
 public:
  using MidiCallback = void (*)(void* context, const uint8_t packet[4]);
  using ConnectionCallback = void (*)(void* context);

  struct Diagnostics {
    uint32_t packetsReceived = 0;
    uint32_t packetsDropped = 0;
    uint32_t transferErrors = 0;
    uint32_t connections = 0;
    uint32_t lastPacketMs = 0;
    uint16_t vendorId = 0;
    uint16_t productId = 0;
    uint16_t endpointPacketSize = 0;
    uint8_t endpointAddress = 0;
  };

  bool begin();
  void poll();
  bool connected() const { return connected_; }
  const String& lastError() const { return lastError_; }
  Diagnostics diagnostics();

  void setMidiCallback(MidiCallback callback, void* context) {
    midiCallback_ = callback;
    midiContext_ = context;
  }
  void setConnectionCallbacks(ConnectionCallback connected, ConnectionCallback disconnected,
                              void* context) {
    connectedCallback_ = connected;
    disconnectedCallback_ = disconnected;
    connectionContext_ = context;
  }

 private:
  struct Packet {
    uint8_t bytes[4];
  };

  static constexpr size_t kQueueSize = 64;
  Packet queue_[kQueueSize]{};
  volatile size_t queueHead_ = 0;
  volatile size_t queueTail_ = 0;
  portMUX_TYPE queueMux_ = portMUX_INITIALIZER_UNLOCKED;

  usb_host_client_handle_t client_ = nullptr;
  usb_device_handle_t device_ = nullptr;
  usb_transfer_t* transfer_ = nullptr;
  TaskHandle_t task_ = nullptr;
  uint8_t interfaceNumber_ = 0;
  uint8_t alternateSetting_ = 0;
  uint8_t endpointAddress_ = 0;
  volatile bool connected_ = false;
  volatile bool resubmitPending_ = false;
  bool reportedConnected_ = false;
  String lastError_;
  Diagnostics diagnostics_;

  MidiCallback midiCallback_ = nullptr;
  void* midiContext_ = nullptr;
  ConnectionCallback connectedCallback_ = nullptr;
  ConnectionCallback disconnectedCallback_ = nullptr;
  void* connectionContext_ = nullptr;

  bool enqueue(const uint8_t packet[4]);
  bool dequeue(Packet& packet);
  bool openMidiInterface(uint8_t address);
  void closeDevice();

  static void hostTask(void* argument);
  static void clientEvent(const usb_host_client_event_msg_t* event, void* argument);
  static void transferComplete(usb_transfer_t* transfer);
};

}  // namespace notefall
