#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
#include <freertos/task.h>
#include <usb/usb_host.h>

namespace notefall {

// USB-MIDI 1.0 host transport for ESP32-S3.
// Architecture derived from ESP32_Host_MIDI v7.2.0 (MIT), reduced to the
// bidirectional transport used by NoteFall 88, with one outstanding transfer
// per endpoint. See THIRD_PARTY_NOTICES.md.
class UsbMidiHost {
 public:
  using MidiCallback = void (*)(void* context, const uint8_t packet[4], uint64_t receivedUs);
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
    uint16_t outputEndpointPacketSize = 0;
    uint8_t outputEndpointAddress = 0;
    uint32_t packetsSent = 0;
    uint32_t outputPacketsDropped = 0;
    uint32_t outputTransferErrors = 0;
  };

  bool begin();
  void poll();
  bool connected() const { return connected_; }
  bool outputAvailable() const { return connected_ && outputEndpointAddress_ != 0; }
  bool sendMidiMessage(uint8_t status, uint8_t data1, uint8_t data2);
  void panic();
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
    uint64_t receivedUs = 0;
  };

  static constexpr size_t kInputQueueSize = 64;
  static constexpr size_t kOutputQueueSize = 128;
  static constexpr size_t kTransferBufferSize = 512;
  Packet inputQueue_[kInputQueueSize]{};
  Packet outputQueue_[kOutputQueueSize]{};
  volatile size_t inputHead_ = 0;
  volatile size_t inputTail_ = 0;
  volatile size_t outputHead_ = 0;
  volatile size_t outputTail_ = 0;
  portMUX_TYPE queueMux_ = portMUX_INITIALIZER_UNLOCKED;

  usb_host_client_handle_t client_ = nullptr;
  usb_device_handle_t device_ = nullptr;
  usb_transfer_t* inputTransfer_ = nullptr;
  usb_transfer_t* outputTransfer_ = nullptr;
  TaskHandle_t task_ = nullptr;
  uint8_t interfaceNumber_ = 0;
  uint8_t alternateSetting_ = 0;
  uint8_t inputEndpointAddress_ = 0;
  uint8_t outputEndpointAddress_ = 0;
  uint16_t inputEndpointPacketSize_ = 0;
  uint16_t outputEndpointPacketSize_ = 0;
  volatile bool connected_ = false;
  volatile bool inputResubmitPending_ = false;
  volatile bool outputBusy_ = false;
  bool reportedConnected_ = false;
  String lastError_;
  Diagnostics diagnostics_;

  MidiCallback midiCallback_ = nullptr;
  void* midiContext_ = nullptr;
  ConnectionCallback connectedCallback_ = nullptr;
  ConnectionCallback disconnectedCallback_ = nullptr;
  void* connectionContext_ = nullptr;

  bool enqueueInput(const uint8_t packet[4], uint64_t receivedUs);
  bool dequeueInput(Packet& packet);
  bool enqueueOutput(const uint8_t packet[4]);
  void clearOutputQueue();
  void pumpOutput();
  bool openMidiInterface(uint8_t address);
  void closeDevice();

  static void hostTask(void* argument);
  static void clientEvent(const usb_host_client_event_msg_t* event, void* argument);
  static void inputTransferComplete(usb_transfer_t* transfer);
  static void outputTransferComplete(usb_transfer_t* transfer);
};

}  // namespace notefall
