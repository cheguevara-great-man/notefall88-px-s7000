import type {
  CalibrationState,
  DeviceStatus,
  MidiControlEvent,
  MidiInputEvent,
  MidiOutResult,
} from "./types";

export type DeviceMessage =
  | { kind: "status"; value: DeviceStatus }
  | { kind: "midi"; value: MidiInputEvent }
  | { kind: "control"; value: MidiControlEvent }
  | { kind: "calibration"; value: CalibrationState }
  | { kind: "midiOutResult"; value: MidiOutResult }
  | { kind: "pong" }
  | { kind: "protocolError"; expected: number; received: number };

export type DecodeResult =
  | { ok: true; message: DeviceMessage }
  | { ok: false; reason: string };

const MAX_INCOMING_MESSAGE_BYTES = 65_536;
const MAX_SAFE_COUNTER = Number.MAX_SAFE_INTEGER;
const UTF8_ENCODER = new TextEncoder();

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("消息根节点不是对象");
  }
  return value as Record<string, unknown>;
}

function requiredBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") throw new Error(`${key} 不是布尔值`);
  return value;
}

function optionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in source)) return undefined;
  return requiredBoolean(source, key);
}

function requiredInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} 不是 ${minimum}..${maximum} 的整数`);
  }
  return value;
}

function optionalInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!(key in source)) return undefined;
  return requiredInteger(source, key, minimum, maximum);
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | undefined {
  if (!(key in source)) return undefined;
  const value = source[key];
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`${key} 不是有效字符串`);
  }
  return value;
}

function statusMessage(source: Record<string, unknown>): DeviceMessage {
  const status: DeviceStatus = {
    piano: requiredBoolean(source, "piano"),
    clients: requiredInteger(source, "clients", 0, 255),
    brightness: requiredInteger(source, "brightness", 1, 4),
    offset: requiredInteger(source, "offset", -8, 8),
    reversed: requiredBoolean(source, "reversed"),
  };

  status.protocol = requiredInteger(source, "protocol", 0, 255);
  status.firmware = optionalString(source, "firmware", 64);
  status.controlSessionReady = optionalBoolean(source, "controlSessionReady");
  status.controlAuthorized = optionalBoolean(source, "controlAuthorized");
  status.accessPointClient = optionalBoolean(source, "accessPointClient");
  status.defaultPassword = optionalBoolean(source, "defaultPassword");
  status.controlToken = optionalString(source, "controlToken", 64);
  status.rssi = optionalInteger(source, "rssi", -127, 0);
  status.uptimeMs = optionalInteger(source, "uptimeMs", 0, 0xffff_ffff);
  status.freeHeap = optionalInteger(source, "freeHeap", 0, 0xffff_ffff);
  status.psramBytes = optionalInteger(source, "psramBytes", 0, 0xffff_ffff);
  status.freePsram = optionalInteger(source, "freePsram", 0, 0xffff_ffff);
  status.nvsReady = optionalBoolean(source, "nvsReady");
  status.resetReason = optionalString(source, "resetReason", 64);
  status.usbPackets = optionalInteger(source, "usbPackets", 0, MAX_SAFE_COUNTER);
  status.usbDropped = optionalInteger(source, "usbDropped", 0, MAX_SAFE_COUNTER);
  status.usbMalformed = optionalInteger(source, "usbMalformed", 0, MAX_SAFE_COUNTER);
  status.usbErrors = optionalInteger(source, "usbErrors", 0, MAX_SAFE_COUNTER);
  status.usbConnections = optionalInteger(source, "usbConnections", 0, MAX_SAFE_COUNTER);
  status.usbLastPacketMs = optionalInteger(source, "usbLastPacketMs", 0, 0xffff_ffff);
  status.usbVid = optionalInteger(source, "usbVid", 0, 0xffff);
  status.usbPid = optionalInteger(source, "usbPid", 0, 0xffff);
  status.usbEndpoint = optionalInteger(source, "usbEndpoint", 0, 0xff);
  status.usbPacketSize = optionalInteger(source, "usbPacketSize", 0, 512);
  status.usbOut = optionalBoolean(source, "usbOut");
  status.usbOutEndpoint = optionalInteger(source, "usbOutEndpoint", 0, 0xff);
  status.usbOutPacketSize = optionalInteger(source, "usbOutPacketSize", 0, 512);
  status.usbOutPackets = optionalInteger(source, "usbOutPackets", 0, MAX_SAFE_COUNTER);
  status.usbOutDropped = optionalInteger(source, "usbOutDropped", 0, MAX_SAFE_COUNTER);
  status.usbOutErrors = optionalInteger(source, "usbOutErrors", 0, MAX_SAFE_COUNTER);
  status.usbOutQueued = optionalInteger(source, "usbOutQueued", 0, 256);
  status.usbOutputMirrorCandidates = optionalInteger(source, "usbOutputMirrorCandidates", 0, MAX_SAFE_COUNTER);
  status.usbOutOwned = optionalBoolean(source, "usbOutOwned");
  status.webRejected = optionalInteger(source, "webRejected", 0, MAX_SAFE_COUNTER);
  status.webAuthRejected = optionalInteger(source, "webAuthRejected", 0, MAX_SAFE_COUNTER);
  status.webMidiDropped = optionalInteger(source, "webMidiDropped", 0, MAX_SAFE_COUNTER);
  status.ledInputLatencyLastUs = optionalInteger(source, "ledInputLatencyLastUs", 0, 0xffff_ffff);
  status.ledInputLatencyAvgUs = optionalInteger(source, "ledInputLatencyAvgUs", 0, 0xffff_ffff);
  status.ledInputLatencyMaxUs = optionalInteger(source, "ledInputLatencyMaxUs", 0, 0xffff_ffff);
  status.ledInputLatencySamples = optionalInteger(source, "ledInputLatencySamples", 0, MAX_SAFE_COUNTER);
  return { kind: "status", value: status };
}

function decodeObject(source: Record<string, unknown>): DeviceMessage {
  const type = source.t;
  if (typeof type !== "string") throw new Error("缺少消息类型");
  if (type === "status") return statusMessage(source);
  if (type === "midi") {
    if (source.s !== "on" && source.s !== "off") throw new Error("MIDI 状态无效");
    return {
      kind: "midi",
      value: {
        state: source.s,
        channel: requiredInteger(source, "ch", 1, 16),
        note: requiredInteger(source, "n", 0, 127),
        velocity: requiredInteger(source, "v", 0, 127),
        highResolutionVelocity: optionalInteger(source, "vh", 0, 16_383),
        timestamp: requiredInteger(source, "ts", 0, 0xffff_ffff),
      },
    };
  }
  if (type === "control") {
    return {
      kind: "control",
      value: {
        channel: requiredInteger(source, "ch", 1, 16),
        controller: requiredInteger(source, "c", 0, 127),
        value: requiredInteger(source, "v", 0, 127),
        timestamp: requiredInteger(source, "ts", 0, 0xffff_ffff),
      },
    };
  }
  if (type === "calibration") {
    if (!Array.isArray(source.offsets) || source.offsets.length !== 88) {
      throw new Error("校准数组必须恰好包含 88 项");
    }
    const offsets = source.offsets.map((value, index) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value < -4 || value > 4) {
        throw new Error(`校准偏移 ${index} 越界`);
      }
      return value;
    });
    return { kind: "calibration", value: { offsets } };
  }
  if (type === "midiOutResult") {
    return {
      kind: "midiOutResult",
      value: {
        ok: requiredBoolean(source, "ok"),
        busy: requiredBoolean(source, "busy"),
        accepted: requiredInteger(source, "accepted", 0, 48),
        queued: requiredInteger(source, "queued", 0, 256),
      },
    };
  }
  if (type === "pong") {
    requiredInteger(source, "ts", 0, MAX_SAFE_COUNTER);
    return { kind: "pong" };
  }
  if (type === "protocolError") {
    return {
      kind: "protocolError",
      expected: requiredInteger(source, "expected", 0, 255),
      received: requiredInteger(source, "received", -1, 255),
    };
  }
  throw new Error(`未知消息类型 ${type}`);
}

export function decodeDeviceMessage(raw: string): DecodeResult {
  // ASCII protocol traffic takes the zero-allocation path. Only a string long
  // enough for multi-byte UTF-8 to cross the cap needs exact encoding.
  const exactSizeNeeded = raw.length > Math.floor(MAX_INCOMING_MESSAGE_BYTES / 3);
  if (raw.length > MAX_INCOMING_MESSAGE_BYTES ||
      (exactSizeNeeded && UTF8_ENCODER.encode(raw).length > MAX_INCOMING_MESSAGE_BYTES)) {
    return { ok: false, reason: "消息超过 65536 字节" };
  }
  try {
    return { ok: true, message: decodeObject(record(JSON.parse(raw) as unknown)) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "消息无法解析" };
  }
}
