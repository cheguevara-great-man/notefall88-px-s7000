const UINT32_RANGE = 0x1_0000_0000;
const MAX_SAMPLES = 12;
const MAX_SAMPLE_RTT_MS = 2_000;
const MAX_EVENT_DELAY_MS = 5_000;
const RESTART_BACKSTEP_MS = 30_000;

interface ClockSample {
  deviceTime: number;
  browserMidpoint: number;
  roundTripMs: number;
}

export interface DeviceTimeEstimate {
  browserTime: number;
  transportDelayMs: number;
  uncertaintyMs: number;
}

function validBrowserTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validDeviceTimestamp(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;
}

/** Unwraps one uint32 device timestamp around a known unbounded reference. */
export function unwrapDeviceTimestamp(timestamp: number, reference: number): number {
  return timestamp + Math.round((reference - timestamp) / UINT32_RANGE) * UINT32_RANGE;
}

/**
 * Maps ESP32 uptime timestamps onto performance.now(). The lowest-RTT sample
 * in a short rolling window limits Wi-Fi queue asymmetry, while every estimate
 * remains bounded by half that sample's round trip.
 */
export class DeviceClockSync {
  private samples: ClockSample[] = [];
  private latestDeviceTime?: number;

  reset(): void {
    this.samples = [];
    this.latestDeviceTime = undefined;
  }

  observe(sentAt: number, receivedAt: number, deviceTimestamp: number): boolean {
    if (!validBrowserTime(sentAt) || !validBrowserTime(receivedAt)
      || receivedAt < sentAt || !validDeviceTimestamp(deviceTimestamp)) return false;
    const roundTripMs = receivedAt - sentAt;
    if (roundTripMs > MAX_SAMPLE_RTT_MS) return false;
    let deviceTime = this.latestDeviceTime === undefined
      ? deviceTimestamp
      : unwrapDeviceTimestamp(deviceTimestamp, this.latestDeviceTime);
    if (this.latestDeviceTime !== undefined && deviceTime < this.latestDeviceTime - RESTART_BACKSTEP_MS) {
      // A reboot resets esp_timer/millis. Never project the new boot through an
      // old offset, even if the WebSocket reconnect races the first status.
      this.reset();
      deviceTime = deviceTimestamp;
    } else if (this.latestDeviceTime !== undefined && deviceTime < this.latestDeviceTime) {
      return false;
    }
    this.latestDeviceTime = deviceTime;
    this.samples.push({
      deviceTime,
      browserMidpoint: sentAt + roundTripMs / 2,
      roundTripMs,
    });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    return true;
  }

  private bestSample(): ClockSample | undefined {
    return this.samples.reduce<ClockSample | undefined>((best, sample) => (
      !best || sample.roundTripMs < best.roundTripMs ? sample : best
    ), undefined);
  }

  uncertaintyMs(): number | undefined {
    const sample = this.bestSample();
    return sample ? sample.roundTripMs / 2 : undefined;
  }

  estimate(deviceTimestamp: number, arrivedAt: number): DeviceTimeEstimate | undefined {
    if (!validDeviceTimestamp(deviceTimestamp) || !validBrowserTime(arrivedAt)) return undefined;
    const sample = this.bestSample();
    if (!sample) return undefined;
    const deviceTime = unwrapDeviceTimestamp(deviceTimestamp, sample.deviceTime);
    const offset = sample.browserMidpoint - sample.deviceTime;
    const projected = deviceTime + offset;
    const uncertaintyMs = sample.roundTripMs / 2;
    const rawDelay = arrivedAt - projected;
    if (rawDelay < -(uncertaintyMs + 4) || rawDelay > MAX_EVENT_DELAY_MS) return undefined;
    return {
      // Capture cannot occur after receipt. A small negative value is legal
      // clock-sync uncertainty, so clamp it instead of inventing future input.
      browserTime: Math.min(arrivedAt, projected),
      transportDelayMs: Math.max(0, rawDelay),
      uncertaintyMs,
    };
  }
}
