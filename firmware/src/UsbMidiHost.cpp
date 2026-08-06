#include "UsbMidiHost.h"

#include <algorithm>
#include <cstring>
#include <esp_timer.h>

#include "midi_core.h"

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
    lastError_ = "usb_host_install failed: " + String(result);
    return false;
  }

  usb_host_client_config_t clientConfig{};
  clientConfig.is_synchronous = true;
  clientConfig.max_num_event_msg = 8;
  clientConfig.async.client_event_callback = clientEvent;
  clientConfig.async.callback_arg = this;
  result = usb_host_client_register(&clientConfig, &client_);
  if (result != ESP_OK) {
    lastError_ = "usb_host_client_register failed: " + String(result);
    usb_host_uninstall();
    return false;
  }
  result = usb_host_transfer_alloc(kTransferBufferSize, 0, &inputTransfer_);
  if (result == ESP_OK) result = usb_host_transfer_alloc(kTransferBufferSize, 0, &outputTransfer_);
  if (result != ESP_OK || inputTransfer_ == nullptr || outputTransfer_ == nullptr) {
    lastError_ = "USB transfer allocation failed: " + String(result);
    usb_host_transfer_free(inputTransfer_);
    usb_host_transfer_free(outputTransfer_);
    inputTransfer_ = nullptr;
    outputTransfer_ = nullptr;
    usb_host_client_deregister(client_);
    client_ = nullptr;
    usb_host_uninstall();
    return false;
  }
  if (xTaskCreatePinnedToCore(hostTask, "usb_midi_host", 4096, this, 5, &task_, 0) != pdPASS) {
    lastError_ = "USB host task allocation failed";
    usb_host_transfer_free(inputTransfer_);
    usb_host_transfer_free(outputTransfer_);
    inputTransfer_ = nullptr;
    outputTransfer_ = nullptr;
    usb_host_client_deregister(client_);
    client_ = nullptr;
    usb_host_uninstall();
    return false;
  }
  lastError_ = "";
  return true;
}

void UsbMidiHost::poll() {
  Packet packet;
  while (dequeueInput(packet)) {
    if (midiCallback_ != nullptr) midiCallback_(midiContext_, packet.bytes, packet.receivedUs);
  }
  const bool current = connected_;
  if (current != reportedConnected_) {
    reportedConnected_ = current;
    ConnectionCallback callback = current ? connectedCallback_ : disconnectedCallback_;
    if (callback != nullptr) callback(connectionContext_);
  }
}

UsbMidiHost::Diagnostics UsbMidiHost::diagnostics() {
  portENTER_CRITICAL(&queueMux_);
  const Diagnostics snapshot = diagnostics_;
  portEXIT_CRITICAL(&queueMux_);
  return snapshot;
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
  if (!outputAvailable()) return;
  clearOutputQueue();
  for (uint8_t channel = 0; channel < 16; ++channel) {
    sendMidiMessage(static_cast<uint8_t>(0xB0U | channel), 64, 0);
    sendMidiMessage(static_cast<uint8_t>(0xB0U | channel), 123, 0);
  }
}

void UsbMidiHost::pumpOutput() {
  if (!outputAvailable() || outputTransfer_ == nullptr || outputBusy_) return;

  portENTER_CRITICAL(&queueMux_);
  size_t availablePackets = outputHead_ >= outputTail_
      ? outputHead_ - outputTail_
      : kOutputQueueSize - outputTail_ + outputHead_;
  const size_t maxPackets = std::max<size_t>(1, outputEndpointPacketSize_ / 4U);
  const size_t packetCount = std::min(availablePackets, maxPackets);
  for (size_t index = 0; index < packetCount; ++index) {
    const size_t queueIndex = (outputTail_ + index) % kOutputQueueSize;
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
    lastError_ = "USB MIDI OUT submit failed: " + String(result);
  }
}

void UsbMidiHost::hostTask(void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(pdMS_TO_TICKS(20), &eventFlags);
    usb_host_client_handle_events(host->client_, pdMS_TO_TICKS(20));
    if (host->inputResubmitPending_ && host->connected_ && host->inputTransfer_ != nullptr) {
      const esp_err_t result = usb_host_transfer_submit(host->inputTransfer_);
      if (result == ESP_OK) {
        host->inputResubmitPending_ = false;
      } else {
        portENTER_CRITICAL(&host->queueMux_);
        ++host->diagnostics_.transferErrors;
        portEXIT_CRITICAL(&host->queueMux_);
      }
    }
    host->pumpOutput();
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
    lastError_ = "USB device open failed: " + String(result);
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
    lastError_ = "USB configuration descriptor unavailable";
    usb_host_device_close(client_, device_);
    device_ = nullptr;
    return false;
  }

  const uint8_t* bytes = config->val;
  const uint16_t total = config->wTotalLength;
  for (uint16_t offset = 0; offset + 2 <= total;) {
    const uint8_t length = bytes[offset];
    if (length < 2 || offset + length > total) break;
    if (bytes[offset + 1] == USB_B_DESCRIPTOR_TYPE_INTERFACE && length >= 9 &&
        bytes[offset + 5] == USB_CLASS_AUDIO && bytes[offset + 6] == 0x03) {
      const uint8_t candidateInterface = bytes[offset + 2];
      const uint8_t candidateAlternate = bytes[offset + 3];
      uint8_t inputAddress = 0;
      uint8_t outputAddress = 0;
      uint16_t inputPacketSize = 0;
      uint16_t outputPacketSize = 0;

      uint16_t endpointOffset = offset + length;
      while (endpointOffset + 2 <= total) {
        const uint8_t endpointLength = bytes[endpointOffset];
        if (endpointLength < 2 || endpointOffset + endpointLength > total) break;
        const uint8_t descriptorType = bytes[endpointOffset + 1];
        if (descriptorType == USB_B_DESCRIPTOR_TYPE_INTERFACE) break;
        const bool isBulkEndpoint = descriptorType == USB_B_DESCRIPTOR_TYPE_ENDPOINT &&
            endpointLength >= 7 && (bytes[endpointOffset + 3] & 0x03U) == 0x02U;
        if (isBulkEndpoint) {
          const uint8_t endpointAddress = bytes[endpointOffset + 2];
          uint16_t packetSize =
              (static_cast<uint16_t>(bytes[endpointOffset + 4]) |
               (static_cast<uint16_t>(bytes[endpointOffset + 5]) << 8U)) & 0x07FFU;
          if (packetSize < 4 || packetSize > 512) packetSize = 64;
          if ((endpointAddress & USB_B_ENDPOINT_ADDRESS_EP_DIR_MASK) != 0 && inputAddress == 0) {
            inputAddress = endpointAddress;
            inputPacketSize = packetSize;
          } else if ((endpointAddress & USB_B_ENDPOINT_ADDRESS_EP_DIR_MASK) == 0 &&
                     outputAddress == 0) {
            outputAddress = endpointAddress;
            outputPacketSize = packetSize;
          }
        }
        endpointOffset += endpointLength;
      }

      if (inputAddress == 0) {
        offset += length;
        continue;
      }
      result = usb_host_interface_claim(client_, device_, candidateInterface, candidateAlternate);
      if (result != ESP_OK) {
        offset += length;
        continue;
      }

      interfaceNumber_ = candidateInterface;
      alternateSetting_ = candidateAlternate;
      inputEndpointAddress_ = inputAddress;
      inputEndpointPacketSize_ = inputPacketSize;
      inputTransfer_->device_handle = device_;
      inputTransfer_->bEndpointAddress = inputEndpointAddress_;
      inputTransfer_->callback = inputTransferComplete;
      inputTransfer_->context = this;
      inputTransfer_->num_bytes = inputEndpointPacketSize_;

      if (outputAddress != 0) {
        outputEndpointAddress_ = outputAddress;
        outputEndpointPacketSize_ = outputPacketSize;
        outputTransfer_->device_handle = device_;
        outputTransfer_->bEndpointAddress = outputEndpointAddress_;
        outputTransfer_->callback = outputTransferComplete;
        outputTransfer_->context = this;
      } else {
        outputEndpointAddress_ = 0;
        outputEndpointPacketSize_ = 0;
      }

      connected_ = true;
      result = usb_host_transfer_submit(inputTransfer_);
      if (result == ESP_OK) {
        portENTER_CRITICAL(&queueMux_);
        ++diagnostics_.connections;
        diagnostics_.endpointAddress = inputEndpointAddress_;
        diagnostics_.endpointPacketSize = inputEndpointPacketSize_;
        diagnostics_.outputEndpointAddress = outputEndpointAddress_;
        diagnostics_.outputEndpointPacketSize = outputEndpointPacketSize_;
        portEXIT_CRITICAL(&queueMux_);
        lastError_ = "";
        return true;
      }

      connected_ = false;
      outputEndpointAddress_ = 0;
      outputEndpointPacketSize_ = 0;
      inputEndpointAddress_ = 0;
      inputEndpointPacketSize_ = 0;
      usb_host_interface_release(client_, device_, interfaceNumber_);
      break;
    }
    offset += length;
  }

  lastError_ = "connected USB device has no MIDI streaming IN endpoint";
  usb_host_device_close(client_, device_);
  device_ = nullptr;
  return false;
}

void UsbMidiHost::inputTransferComplete(usb_transfer_t* transfer) {
  auto* host = static_cast<UsbMidiHost*>(transfer->context);
  if (host == nullptr) return;
  if (transfer->status == USB_TRANSFER_STATUS_COMPLETED) {
    const uint64_t receivedUs = static_cast<uint64_t>(esp_timer_get_time());
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
      }
    }
  } else if (host->connected_ && transfer->status != USB_TRANSFER_STATUS_CANCELED &&
             transfer->status != USB_TRANSFER_STATUS_NO_DEVICE) {
    portENTER_CRITICAL(&host->queueMux_);
    ++host->diagnostics_.transferErrors;
    portEXIT_CRITICAL(&host->queueMux_);
  }
  if (host->connected_) {
    const esp_err_t result = usb_host_transfer_submit(transfer);
    if (result != ESP_OK) {
      portENTER_CRITICAL(&host->queueMux_);
      ++host->diagnostics_.transferErrors;
      portEXIT_CRITICAL(&host->queueMux_);
      host->lastError_ = "USB MIDI IN resubmit failed: " + String(result);
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
  } else if (host->connected_ && transfer->status != USB_TRANSFER_STATUS_CANCELED &&
             transfer->status != USB_TRANSFER_STATUS_NO_DEVICE) {
    ++host->diagnostics_.outputTransferErrors;
    host->diagnostics_.outputPacketsDropped += static_cast<uint32_t>(transfer->num_bytes / 4U);
  }
  portEXIT_CRITICAL(&host->queueMux_);
  host->outputBusy_ = false;
}

void UsbMidiHost::closeDevice() {
  connected_ = false;
  inputResubmitPending_ = false;
  outputBusy_ = false;
  if (inputTransfer_ != nullptr && inputEndpointAddress_ != 0) {
    usb_host_endpoint_halt(device_, inputEndpointAddress_);
    usb_host_endpoint_flush(device_, inputEndpointAddress_);
  }
  if (outputTransfer_ != nullptr && outputEndpointAddress_ != 0) {
    usb_host_endpoint_halt(device_, outputEndpointAddress_);
    usb_host_endpoint_flush(device_, outputEndpointAddress_);
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
  outputEndpointAddress_ = 0;
  inputEndpointPacketSize_ = 0;
  outputEndpointPacketSize_ = 0;
}

}  // namespace notefall
