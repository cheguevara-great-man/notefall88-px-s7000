#include "UsbMidiHost.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <esp_task_wdt.h>
#include <esp_timer.h>

#include "midi_core.h"
#include "usb_midi_descriptor.h"

namespace notefall {

#ifdef CONFIG_USB_HOST_ENABLE_ENUM_FILTER_CALLBACK
static bool acceptAnyUsbDevice(const usb_device_desc_t*, uint8_t*) { return true; }
#endif

bool UsbMidiHost::begin() {
  usb_host_config_t hostConfig{};
  hostConfig.skip_phy_setup = false;
  hostConfig.intr_flags = ESP_INTR_FLAG_LEVEL1;
#ifdef CONFIG_USB_HOST_ENABLE_ENUM_FILTER_CALLBACK
  hostConfig.enum_filter_cb = acceptAnyUsbDevice;
#endif
  esp_err_t result = usb_host_install(&hostConfig);
  if (result != ESP_OK) {
    setLastError("usb_host_install failed", result);
    return false;
  }

  usb_host_client_config_t clientConfig{};
  clientConfig.is_synchronous = true;
  clientConfig.max_num_event_msg = 8;
  clientConfig.async.client_event_callback = clientEvent;
  clientConfig.async.callback_arg = this;
  result = usb_host_client_register(&clientConfig, &client_);
  if (result != ESP_OK) {
    setLastError("usb_host_client_register failed", result);
    usb_host_uninstall();
    return false;
  }
  result = usb_host_transfer_alloc(kTransferBufferSize, 0, &inputTransfer_);
  if (result == ESP_OK) result = usb_host_transfer_alloc(kTransferBufferSize, 0, &outputTransfer_);
  if (result != ESP_OK || inputTransfer_ == nullptr || outputTransfer_ == nullptr) {
    setLastError("USB transfer allocation failed", result);
    usb_host_transfer_free(inputTransfer_);
    usb_host_transfer_free(outputTransfer_);
    inputTransfer_ = nullptr;
    outputTransfer_ = nullptr;
    usb_host_client_deregister(client_);
    client_ = nullptr;
    usb_host_uninstall();
    return false;
  }
  if (xTaskCreatePinnedToCore(hostTask, "usb_midi_client", 4096, this, 6, &task_, 0) != pdPASS) {
    setLastError("USB client task allocation failed");
    usb_host_transfer_free(inputTransfer_);
    usb_host_transfer_free(outputTransfer_);
    inputTransfer_ = nullptr;
    outputTransfer_ = nullptr;
    usb_host_client_deregister(client_);
    client_ = nullptr;
    usb_host_uninstall();
    return false;
  }
  if (xTaskCreatePinnedToCore(daemonTask, "usb_midi_daemon", 3072, this, 4,
                              &daemonTask_, 0) != pdPASS) {
    setLastError("USB daemon task allocation failed");
    vTaskDelete(task_);
    task_ = nullptr;
    usb_host_transfer_free(inputTransfer_);
    usb_host_transfer_free(outputTransfer_);
    inputTransfer_ = nullptr;
    outputTransfer_ = nullptr;
    usb_host_client_deregister(client_);
    client_ = nullptr;
    usb_host_uninstall();
    return false;
  }
  setLastError("");
  return true;
}

void UsbMidiHost::poll() {
  Packet packet;
  while (dequeueInput(packet)) {
    if (midiCallback_ != nullptr) midiCallback_(midiContext_, packet.bytes, packet.receivedUs);
  }
  const bool current = connected_.load(std::memory_order_acquire);
  if (current != reportedConnected_) {
    reportedConnected_ = current;
    ConnectionCallback callback = current ? connectedCallback_ : disconnectedCallback_;
    if (callback != nullptr) callback(connectionContext_);
  }
}

UsbMidiHost::Diagnostics UsbMidiHost::diagnostics() {
  portENTER_CRITICAL(&queueMux_);
  Diagnostics snapshot = diagnostics_;
  const size_t inputDepth = inputHead_ >= inputTail_
      ? inputHead_ - inputTail_
      : kInputQueueSize - inputTail_ + inputHead_;
  const size_t outputDepth = outputHead_ >= outputTail_
      ? outputHead_ - outputTail_
      : kOutputQueueSize - outputTail_ + outputHead_;
  snapshot.inputQueueDepth = static_cast<uint16_t>(inputDepth);
  snapshot.outputQueueDepth = static_cast<uint16_t>(outputDepth);
  portEXIT_CRITICAL(&queueMux_);
  return snapshot;
}

String UsbMidiHost::lastError() {
  char snapshot[sizeof(lastError_)]{};
  portENTER_CRITICAL(&queueMux_);
  std::memcpy(snapshot, lastError_, sizeof(snapshot));
  portEXIT_CRITICAL(&queueMux_);
  snapshot[sizeof(snapshot) - 1U] = '\0';
  return String(snapshot);
}

void UsbMidiHost::setLastError(const char* message) {
  char formatted[sizeof(lastError_)]{};
  std::snprintf(formatted, sizeof(formatted), "%s", message == nullptr ? "" : message);
  portENTER_CRITICAL(&queueMux_);
  std::memcpy(lastError_, formatted, sizeof(lastError_));
  portEXIT_CRITICAL(&queueMux_);
}

void UsbMidiHost::setLastError(const char* operation, esp_err_t result) {
  char formatted[sizeof(lastError_)]{};
  std::snprintf(formatted, sizeof(formatted), "%s: %ld",
                operation == nullptr ? "USB error" : operation,
                static_cast<long>(result));
  portENTER_CRITICAL(&queueMux_);
  std::memcpy(lastError_, formatted, sizeof(lastError_));
  portEXIT_CRITICAL(&queueMux_);
}

void UsbMidiHost::notifyConsumer() {
  const TaskHandle_t consumer = consumerTask_.load(std::memory_order_acquire);
  if (consumer != nullptr) xTaskNotifyGive(consumer);
}

bool UsbMidiHost::enqueueInput(const uint8_t packet[4], uint64_t receivedUs) {
  portENTER_CRITICAL(&queueMux_);
  const size_t next = (inputHead_ + 1) % kInputQueueSize;
  if (next == inputTail_) {
    portEXIT_CRITICAL(&queueMux_);
    return false;
  }
  std::memcpy(inputQueue_[inputHead_].bytes, packet, 4);
  inputQueue_[inputHead_].receivedUs = receivedUs;
  inputHead_ = next;
  const size_t depth = inputHead_ >= inputTail_
      ? inputHead_ - inputTail_
      : kInputQueueSize - inputTail_ + inputHead_;
  diagnostics_.inputQueueHighWater = std::max<uint16_t>(
      diagnostics_.inputQueueHighWater, static_cast<uint16_t>(depth));
  portEXIT_CRITICAL(&queueMux_);
  return true;
}

bool UsbMidiHost::dequeueInput(Packet& packet) {
  portENTER_CRITICAL(&queueMux_);
  if (inputTail_ == inputHead_) {
    portEXIT_CRITICAL(&queueMux_);
    return false;
  }
  packet = inputQueue_[inputTail_];
  inputTail_ = (inputTail_ + 1) % kInputQueueSize;
  portEXIT_CRITICAL(&queueMux_);
  return true;
}

bool UsbMidiHost::enqueueOutput(const uint8_t packet[4]) {
  portENTER_CRITICAL(&queueMux_);
  const size_t next = (outputHead_ + 1) % kOutputQueueSize;
  if (next == outputTail_) {
    portEXIT_CRITICAL(&queueMux_);
    return false;
  }
  std::memcpy(outputQueue_[outputHead_].bytes, packet, 4);
  outputHead_ = next;
  const size_t depth = outputHead_ >= outputTail_
      ? outputHead_ - outputTail_
      : kOutputQueueSize - outputTail_ + outputHead_;
  diagnostics_.outputQueueHighWater = std::max<uint16_t>(
      diagnostics_.outputQueueHighWater, static_cast<uint16_t>(depth));
  portEXIT_CRITICAL(&queueMux_);
  return true;
}

bool UsbMidiHost::sendMidiMessage(uint8_t status, uint8_t data1, uint8_t data2) {
  if (!outputAvailable()) return false;
  uint8_t packet[4]{};
  if (!midi::encodeUsbEventPacket(status, data1, data2, packet)) return false;
  return enqueueOutput(packet);
}

void UsbMidiHost::clearOutputQueue() {
  portENTER_CRITICAL(&queueMux_);
  outputHead_ = outputTail_ = 0;
  portEXIT_CRITICAL(&queueMux_);
}

void UsbMidiHost::panic() {
  clearOutputQueue();
  if (!outputAvailable()) return;
  for (uint8_t channel = 0; channel < 16; ++channel) {
    sendMidiMessage(static_cast<uint8_t>(0xB0U | channel), 64, 0);
    sendMidiMessage(static_cast<uint8_t>(0xB0U | channel), 123, 0);
  }
}

void UsbMidiHost::pumpOutput() {
  if (!outputAvailable() || outputTransfer_ == nullptr || outputBusy_) return;

  portENTER_CRITICAL(&queueMux_);
  const size_t outputTail = outputTail_;
  const size_t availablePackets = outputHead_ >= outputTail_
      ? outputHead_ - outputTail_
      : kOutputQueueSize - outputTail_ + outputHead_;
  const size_t maxPackets = std::max<size_t>(1, outputEndpointPacketSize_ / 4U);
  const size_t packetCount = std::min(availablePackets, maxPackets);
  // Keep the at-most-one-endpoint-packet copy in the critical section. Panic
  // may reset and immediately refill the ring from the other core; copying
  // outside the lock could otherwise combine pre- and post-panic messages.
  for (size_t index = 0; index < packetCount; ++index) {
    const size_t queueIndex = (outputTail + index) % kOutputQueueSize;
    std::memcpy(outputTransfer_->data_buffer + index * 4U, outputQueue_[queueIndex].bytes, 4);
  }
  portEXIT_CRITICAL(&queueMux_);
  if (packetCount == 0) return;

  outputTransfer_->num_bytes = packetCount * 4U;
  outputBusy_ = true;
  const esp_err_t result = usb_host_transfer_submit(outputTransfer_);
  if (result == ESP_OK) {
    portENTER_CRITICAL(&queueMux_);
    outputTail_ = (outputTail_ + packetCount) % kOutputQueueSize;
    portEXIT_CRITICAL(&queueMux_);
  } else {
    outputBusy_ = false;
    portENTER_CRITICAL(&queueMux_);
    ++diagnostics_.outputTransferErrors;
    portEXIT_CRITICAL(&queueMux_);
    setLastError("USB MIDI OUT submit failed", result);
  }
}

void UsbMidiHost::hostTask(void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  const bool watchdogArmed = esp_task_wdt_add(nullptr) == ESP_OK;
  portENTER_CRITICAL(&host->queueMux_);
  host->diagnostics_.clientWatchdogArmed = watchdogArmed;
  portEXIT_CRITICAL(&host->queueMux_);
  for (;;) {
    // Client and daemon events have separate tasks. A MIDI transfer therefore
    // never sits behind the daemon's idle wait (formerly up to 20 ms).
    usb_host_client_handle_events(host->client_, pdMS_TO_TICKS(5));
    if (host->inputResubmitPending_ && host->connected_.load(std::memory_order_acquire) &&
        host->inputTransfer_ != nullptr) {
      const esp_err_t result = usb_host_transfer_submit(host->inputTransfer_);
      if (result == ESP_OK) {
        host->inputResubmitPending_ = false;
      } else {
        portENTER_CRITICAL(&host->queueMux_);
        ++host->diagnostics_.transferErrors;
        ++host->diagnostics_.inputResubmitRetries;
        portEXIT_CRITICAL(&host->queueMux_);
      }
    }
    host->pumpOutput();
    if (watchdogArmed) esp_task_wdt_reset();
  }
}

void UsbMidiHost::daemonTask(void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  const bool watchdogArmed = esp_task_wdt_add(nullptr) == ESP_OK;
  portENTER_CRITICAL(&host->queueMux_);
  host->diagnostics_.daemonWatchdogArmed = watchdogArmed;
  portEXIT_CRITICAL(&host->queueMux_);
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(pdMS_TO_TICKS(20), &eventFlags);
    if (watchdogArmed) esp_task_wdt_reset();
  }
}

void UsbMidiHost::clientEvent(const usb_host_client_event_msg_t* event, void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  if (event->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
    host->openMidiInterface(event->new_dev.address);
  } else if (event->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
    host->closeDevice();
  }
}

bool UsbMidiHost::openMidiInterface(uint8_t address) {
  if (device_ != nullptr) return false;
  esp_err_t result = usb_host_device_open(client_, address, &device_);
  if (result != ESP_OK) {
    setLastError("USB device open failed", result);
    return false;
  }

  const usb_device_desc_t* deviceDescriptor = nullptr;
  if (usb_host_get_device_descriptor(device_, &deviceDescriptor) == ESP_OK &&
      deviceDescriptor != nullptr) {
    portENTER_CRITICAL(&queueMux_);
    diagnostics_.vendorId = deviceDescriptor->idVendor;
    diagnostics_.productId = deviceDescriptor->idProduct;
    portEXIT_CRITICAL(&queueMux_);
  }

  const usb_config_desc_t* config = nullptr;
  result = usb_host_get_active_config_descriptor(device_, &config);
  if (result != ESP_OK || config == nullptr) {
    setLastError("USB configuration descriptor unavailable");
    usb_host_device_close(client_, device_);
    device_ = nullptr;
    return false;
  }
  setLastError("");

  const uint8_t* bytes = config->val;
  const std::size_t total = config->wTotalLength;
  std::size_t searchOffset = 0;
  for (;;) {
    usb::MidiStreamingInterface candidate;
    const usb::DescriptorResult descriptorResult =
        usb::findMidiStreamingInterface(bytes, total, searchOffset, candidate);
    if (descriptorResult == usb::DescriptorResult::Malformed) {
      setLastError("malformed USB configuration descriptor");
      break;
    }
    if (descriptorResult == usb::DescriptorResult::NotFound) break;
    searchOffset = candidate.nextSearchOffset;
    result = usb_host_interface_claim(client_, device_, candidate.interfaceNumber,
                                      candidate.alternateSetting);
    if (result != ESP_OK) continue;

    interfaceNumber_ = candidate.interfaceNumber;
    alternateSetting_ = candidate.alternateSetting;
    inputEndpointAddress_ = candidate.inputEndpointAddress;
    inputEndpointPacketSize_ = candidate.inputPacketSize;
    inputTransfer_->device_handle = device_;
    inputTransfer_->bEndpointAddress = inputEndpointAddress_;
    inputTransfer_->callback = inputTransferComplete;
    inputTransfer_->context = this;
    inputTransfer_->num_bytes = inputEndpointPacketSize_;

    if (candidate.outputEndpointAddress != 0) {
      outputEndpointAddress_.store(candidate.outputEndpointAddress, std::memory_order_release);
      outputEndpointPacketSize_ = candidate.outputPacketSize;
      outputTransfer_->device_handle = device_;
      outputTransfer_->bEndpointAddress = candidate.outputEndpointAddress;
      outputTransfer_->callback = outputTransferComplete;
      outputTransfer_->context = this;
    } else {
      outputEndpointAddress_.store(0, std::memory_order_release);
      outputEndpointPacketSize_ = 0;
    }

    result = usb_host_transfer_submit(inputTransfer_);
    if (result == ESP_OK) {
      portENTER_CRITICAL(&queueMux_);
      ++diagnostics_.connections;
      diagnostics_.endpointAddress = inputEndpointAddress_;
      diagnostics_.endpointPacketSize = inputEndpointPacketSize_;
      diagnostics_.outputEndpointAddress =
          outputEndpointAddress_.load(std::memory_order_acquire);
      diagnostics_.outputEndpointPacketSize = outputEndpointPacketSize_;
      portEXIT_CRITICAL(&queueMux_);
      // Publish endpoint configuration only after the first IN transfer is
      // live. The acquire in outputAvailable() then also makes the endpoint
      // fields above visible to producers on the other core.
      connected_.store(true, std::memory_order_release);
      setLastError("");
      notifyConsumer();
      return true;
    }

    connected_.store(false, std::memory_order_release);
    outputEndpointAddress_.store(0, std::memory_order_release);
    outputEndpointPacketSize_ = 0;
    inputEndpointAddress_ = 0;
    inputEndpointPacketSize_ = 0;
    usb_host_interface_release(client_, device_, interfaceNumber_);
    break;
  }

  if (lastError().isEmpty()) {
    setLastError("connected USB device has no MIDI streaming IN endpoint");
  }
  usb_host_device_close(client_, device_);
  device_ = nullptr;
  return false;
}

void UsbMidiHost::inputTransferComplete(usb_transfer_t* transfer) {
  auto* host = static_cast<UsbMidiHost*>(transfer->context);
  if (host == nullptr) return;
  if (transfer->status == USB_TRANSFER_STATUS_COMPLETED) {
    const uint64_t receivedUs = static_cast<uint64_t>(esp_timer_get_time());
    const uint16_t batchSize = static_cast<uint16_t>(
        std::max(0, transfer->actual_num_bytes) / 4);
    portENTER_CRITICAL(&host->queueMux_);
    host->diagnostics_.largestInputBatch = std::max(
        host->diagnostics_.largestInputBatch, batchSize);
    portEXIT_CRITICAL(&host->queueMux_);
    bool queuedAny = false;
    for (int offset = 0; offset + 4 <= transfer->actual_num_bytes; offset += 4) {
      const uint8_t* packet = transfer->data_buffer + offset;
      midi::DecodedMessage decoded;
      const midi::PacketResult packetResult = midi::classifyUsbEventPacket(packet, decoded);
      if (packetResult == midi::PacketResult::Malformed) {
        portENTER_CRITICAL(&host->queueMux_);
        ++host->diagnostics_.packetsMalformed;
        portEXIT_CRITICAL(&host->queueMux_);
        continue;
      }
      if (packetResult == midi::PacketResult::UnsupportedSystem) continue;
      portENTER_CRITICAL(&host->queueMux_);
      ++host->diagnostics_.packetsReceived;
      host->diagnostics_.lastPacketMs = millis();
      portEXIT_CRITICAL(&host->queueMux_);
      if (!host->enqueueInput(packet, receivedUs)) {
        portENTER_CRITICAL(&host->queueMux_);
        ++host->diagnostics_.packetsDropped;
        portEXIT_CRITICAL(&host->queueMux_);
      } else {
        queuedAny = true;
      }
    }
    // Wake once after the complete USB transfer has been queued. The higher-
    // priority consumer then cannot split one chord packet batch into several
    // LED frames, while sustained traffic cannot starve it behind this task.
    if (queuedAny) host->notifyConsumer();
  } else if (host->connected_.load(std::memory_order_acquire) &&
             transfer->status != USB_TRANSFER_STATUS_CANCELED &&
             transfer->status != USB_TRANSFER_STATUS_NO_DEVICE) {
    portENTER_CRITICAL(&host->queueMux_);
    ++host->diagnostics_.transferErrors;
    portEXIT_CRITICAL(&host->queueMux_);
  }
  if (host->connected_.load(std::memory_order_acquire)) {
    const esp_err_t result = usb_host_transfer_submit(transfer);
    if (result != ESP_OK) {
      portENTER_CRITICAL(&host->queueMux_);
      ++host->diagnostics_.transferErrors;
      portEXIT_CRITICAL(&host->queueMux_);
      host->setLastError("USB MIDI IN resubmit failed", result);
      host->inputResubmitPending_ = true;
    }
  }
}

void UsbMidiHost::outputTransferComplete(usb_transfer_t* transfer) {
  auto* host = static_cast<UsbMidiHost*>(transfer->context);
  if (host == nullptr) return;
  portENTER_CRITICAL(&host->queueMux_);
  if (transfer->status == USB_TRANSFER_STATUS_COMPLETED) {
    const int transferred = transfer->actual_num_bytes > 0
        ? transfer->actual_num_bytes
        : transfer->num_bytes;
    host->diagnostics_.packetsSent += static_cast<uint32_t>(transferred / 4U);
  } else if (host->connected_.load(std::memory_order_acquire) &&
             transfer->status != USB_TRANSFER_STATUS_CANCELED &&
             transfer->status != USB_TRANSFER_STATUS_NO_DEVICE) {
    ++host->diagnostics_.outputTransferErrors;
    host->diagnostics_.outputPacketsDropped += static_cast<uint32_t>(transfer->num_bytes / 4U);
  }
  portEXIT_CRITICAL(&host->queueMux_);
  host->outputBusy_ = false;
}

void UsbMidiHost::closeDevice() {
  connected_.store(false, std::memory_order_release);
  inputResubmitPending_ = false;
  outputBusy_ = false;
  if (inputTransfer_ != nullptr && inputEndpointAddress_ != 0) {
    usb_host_endpoint_halt(device_, inputEndpointAddress_);
    usb_host_endpoint_flush(device_, inputEndpointAddress_);
  }
  const uint8_t outputEndpoint = outputEndpointAddress_.load(std::memory_order_acquire);
  if (outputTransfer_ != nullptr && outputEndpoint != 0) {
    usb_host_endpoint_halt(device_, outputEndpoint);
    usb_host_endpoint_flush(device_, outputEndpoint);
  }
  if (device_ != nullptr) {
    usb_host_interface_release(client_, device_, interfaceNumber_);
    usb_host_device_close(client_, device_);
    device_ = nullptr;
  }
  portENTER_CRITICAL(&queueMux_);
  inputHead_ = inputTail_ = 0;
  outputHead_ = outputTail_ = 0;
  diagnostics_.endpointAddress = 0;
  diagnostics_.endpointPacketSize = 0;
  diagnostics_.outputEndpointAddress = 0;
  diagnostics_.outputEndpointPacketSize = 0;
  portEXIT_CRITICAL(&queueMux_);
  inputEndpointAddress_ = 0;
  outputEndpointAddress_.store(0, std::memory_order_release);
  inputEndpointPacketSize_ = 0;
  outputEndpointPacketSize_ = 0;
  notifyConsumer();
}

}  // namespace notefall
