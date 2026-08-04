#include "UsbMidiHost.h"

#include <cstring>

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
    return false;
  }
  if (xTaskCreatePinnedToCore(hostTask, "usb_midi_host", 4096, this, 5, &task_, 0) != pdPASS) {
    lastError_ = "USB host task allocation failed";
    return false;
  }
  lastError_ = "";
  return true;
}

void UsbMidiHost::poll() {
  Packet packet;
  while (dequeue(packet)) {
    if (midiCallback_ != nullptr) midiCallback_(midiContext_, packet.bytes);
  }
}

bool UsbMidiHost::enqueue(const uint8_t packet[4]) {
  portENTER_CRITICAL(&queueMux_);
  const size_t next = (queueHead_ + 1) % kQueueSize;
  if (next == queueTail_) {
    portEXIT_CRITICAL(&queueMux_);
    return false;
  }
  std::memcpy(queue_[queueHead_].bytes, packet, 4);
  queueHead_ = next;
  portEXIT_CRITICAL(&queueMux_);
  return true;
}

bool UsbMidiHost::dequeue(Packet& packet) {
  portENTER_CRITICAL(&queueMux_);
  if (queueTail_ == queueHead_) {
    portEXIT_CRITICAL(&queueMux_);
    return false;
  }
  packet = queue_[queueTail_];
  queueTail_ = (queueTail_ + 1) % kQueueSize;
  portEXIT_CRITICAL(&queueMux_);
  return true;
}

void UsbMidiHost::hostTask(void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  for (;;) {
    uint32_t eventFlags = 0;
    usb_host_lib_handle_events(pdMS_TO_TICKS(20), &eventFlags);
    usb_host_client_handle_events(host->client_, pdMS_TO_TICKS(20));
  }
}

void UsbMidiHost::clientEvent(const usb_host_client_event_msg_t* event, void* argument) {
  auto* host = static_cast<UsbMidiHost*>(argument);
  if (event->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
    if (host->openMidiInterface(event->new_dev.address)) {
      if (host->connectedCallback_ != nullptr) {
        host->connectedCallback_(host->connectionContext_);
      }
    }
  } else if (event->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
    host->closeDevice();
    if (host->disconnectedCallback_ != nullptr) {
      host->disconnectedCallback_(host->connectionContext_);
    }
  }
}

bool UsbMidiHost::openMidiInterface(uint8_t address) {
  if (device_ != nullptr) return false;
  esp_err_t result = usb_host_device_open(client_, address, &device_);
  if (result != ESP_OK) {
    lastError_ = "USB device open failed: " + String(result);
    return false;
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
      interfaceNumber_ = bytes[offset + 2];
      alternateSetting_ = bytes[offset + 3];
      const uint8_t endpointCount = bytes[offset + 4];
      uint16_t endpointOffset = offset + length;
      while (endpointOffset + 2 <= total) {
        const uint8_t endpointLength = bytes[endpointOffset];
        if (endpointLength < 2 || endpointOffset + endpointLength > total) break;
        const uint8_t descriptorType = bytes[endpointOffset + 1];
        if (descriptorType == USB_B_DESCRIPTOR_TYPE_INTERFACE) break;
        if (descriptorType == USB_B_DESCRIPTOR_TYPE_ENDPOINT && endpointLength >= 7 &&
            endpointCount > 0 && (bytes[endpointOffset + 2] & USB_B_ENDPOINT_ADDRESS_EP_DIR_MASK)) {
          endpointAddress_ = bytes[endpointOffset + 2];
          uint16_t packetSize = static_cast<uint16_t>(bytes[endpointOffset + 4]) |
                                (static_cast<uint16_t>(bytes[endpointOffset + 5]) << 8U);
          if (packetSize == 0 || packetSize > 512) packetSize = 64;
          result = usb_host_interface_claim(client_, device_, interfaceNumber_, alternateSetting_);
          if (result != ESP_OK) break;
          result = usb_host_transfer_alloc(packetSize, 0, &transfer_);
          if (result != ESP_OK || transfer_ == nullptr) {
            usb_host_interface_release(client_, device_, interfaceNumber_);
            break;
          }
          transfer_->device_handle = device_;
          transfer_->bEndpointAddress = endpointAddress_;
          transfer_->callback = transferComplete;
          transfer_->context = this;
          transfer_->num_bytes = packetSize;
          connected_ = true;
          result = usb_host_transfer_submit(transfer_);
          if (result == ESP_OK) {
            lastError_ = "";
            return true;
          }
          connected_ = false;
          usb_host_transfer_free(transfer_);
          transfer_ = nullptr;
          usb_host_interface_release(client_, device_, interfaceNumber_);
          break;
        }
        endpointOffset += endpointLength;
      }
    }
    offset += length;
  }

  lastError_ = "connected USB device has no MIDI streaming IN endpoint";
  usb_host_device_close(client_, device_);
  device_ = nullptr;
  return false;
}

void UsbMidiHost::transferComplete(usb_transfer_t* transfer) {
  auto* host = static_cast<UsbMidiHost*>(transfer->context);
  if (host == nullptr) return;
  if (transfer->status == USB_TRANSFER_STATUS_COMPLETED) {
    for (int offset = 0; offset + 4 <= transfer->actual_num_bytes; offset += 4) {
      const uint8_t* packet = transfer->data_buffer + offset;
      if ((packet[0] & 0x0F) != 0) host->enqueue(packet);
    }
  }
  if (host->connected_) {
    const esp_err_t result = usb_host_transfer_submit(transfer);
    if (result != ESP_OK) host->lastError_ = "USB MIDI transfer resubmit failed: " + String(result);
  }
}

void UsbMidiHost::closeDevice() {
  connected_ = false;
  if (transfer_ != nullptr) {
    usb_host_endpoint_halt(device_, endpointAddress_);
    usb_host_endpoint_flush(device_, endpointAddress_);
    usb_host_transfer_free(transfer_);
    transfer_ = nullptr;
  }
  if (device_ != nullptr) {
    usb_host_interface_release(client_, device_, interfaceNumber_);
    usb_host_device_close(client_, device_);
    device_ = nullptr;
  }
  portENTER_CRITICAL(&queueMux_);
  queueHead_ = queueTail_ = 0;
  portEXIT_CRITICAL(&queueMux_);
}

}  // namespace notefall
