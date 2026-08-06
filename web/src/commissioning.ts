import type { DeviceStatus, MidiInputEvent } from "./types";

const STORAGE_KEY = "notefall88.commissioning.v1";

export interface CommissioningState {
  version: 1;
  manual: {
    wiringInspected: boolean;
    fuseInstalled: boolean;
    stripPowerSeparate: boolean;
    mountNonDamaging: boolean;
    lightA0: boolean;
    lightC4: boolean;
    lightC8: boolean;
    mountStable: boolean;
  };
  observed: {
    deviceSeen: boolean;
    pianoSeen: boolean;
    c4Seen: boolean;
    passwordChanged: boolean;
    usbInEndpoint?: number;
    usbOutEndpoint?: number;
    firmware?: string;
    protocol?: number;
    vid?: number;
    pid?: number;
    inputPackets?: number;
    inputErrors?: number;
  };
  completedAt?: number;
  completedFirmware?: string;
}

export interface CommissioningReport {
  product: "NoteFall 88";
  version: 1;
  exportedAt: string;
  complete: boolean;
  missing: string[];
  state: CommissioningState;
}

type CommissioningStorage = Pick<Storage, "getItem" | "setItem">;

export function newCommissioningState(): CommissioningState {
  return {
    version: 1,
    manual: {
      wiringInspected: false,
      fuseInstalled: false,
      stripPowerSeparate: false,
      mountNonDamaging: false,
      lightA0: false,
      lightC4: false,
      lightC8: false,
      mountStable: false,
    },
    observed: { deviceSeen: false, pianoSeen: false, c4Seen: false, passwordChanged: false },
  };
}

function normalize(value: unknown): CommissioningState {
  const fallback = newCommissioningState();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<CommissioningState>;
  if (candidate.version !== 1 || !candidate.manual || !candidate.observed) return fallback;
  const manual = Object.fromEntries(
    Object.keys(fallback.manual).map((key) => [key, candidate.manual?.[key as keyof CommissioningState["manual"]] === true]),
  ) as unknown as CommissioningState["manual"];
  const finite = (item: unknown) => Number.isFinite(item) ? Number(item) : undefined;
  return {
    version: 1,
    manual,
    observed: {
      deviceSeen: candidate.observed.deviceSeen === true,
      pianoSeen: candidate.observed.pianoSeen === true,
      c4Seen: candidate.observed.c4Seen === true,
      passwordChanged: candidate.observed.passwordChanged === true,
      usbInEndpoint: finite(candidate.observed.usbInEndpoint),
      usbOutEndpoint: finite(candidate.observed.usbOutEndpoint),
      firmware: typeof candidate.observed.firmware === "string" ? candidate.observed.firmware : undefined,
      protocol: finite(candidate.observed.protocol),
      vid: finite(candidate.observed.vid),
      pid: finite(candidate.observed.pid),
      inputPackets: finite(candidate.observed.inputPackets),
      inputErrors: finite(candidate.observed.inputErrors),
    },
    completedAt: finite(candidate.completedAt),
    completedFirmware: typeof candidate.completedFirmware === "string" ? candidate.completedFirmware : undefined,
  };
}

export function loadCommissioning(storage?: CommissioningStorage): CommissioningState {
  try {
    const raw = (storage ?? localStorage).getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : newCommissioningState();
  } catch {
    return newCommissioningState();
  }
}

export function saveCommissioning(state: CommissioningState, storage?: CommissioningStorage): void {
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify(normalize(state)));
  } catch {
    // Commissioning remains usable in memory when storage is unavailable.
  }
}

export function observeDevice(
  state: CommissioningState,
  status: DeviceStatus,
): CommissioningState {
  const next = structuredClone(state);
  next.observed.deviceSeen = status.protocol === 6;
  next.observed.passwordChanged = status.defaultPassword === false;
  next.observed.pianoSeen ||= status.piano;
  next.observed.usbInEndpoint = status.usbEndpoint || next.observed.usbInEndpoint;
  next.observed.usbOutEndpoint = status.usbOutEndpoint || next.observed.usbOutEndpoint;
  next.observed.firmware = status.firmware ?? next.observed.firmware;
  next.observed.protocol = status.protocol ?? next.observed.protocol;
  next.observed.vid = status.usbVid || next.observed.vid;
  next.observed.pid = status.usbPid || next.observed.pid;
  if (!(next.observed.inputPackets && next.observed.inputPackets > 0)) {
    next.observed.inputPackets = status.usbPackets ?? next.observed.inputPackets;
  }
  const inputCounters = [status.usbDropped, status.usbMalformed, status.usbErrors];
  if (inputCounters.some((value) => value !== undefined)) {
    next.observed.inputErrors = inputCounters.reduce<number>(
      (total, value) => total + (value ?? 0), 0,
    );
  }
  if (next.completedAt && next.completedFirmware && status.firmware
      && next.completedFirmware !== status.firmware) {
    next.completedAt = undefined;
    next.observed.pianoSeen = false;
    next.observed.c4Seen = false;
    next.observed.usbInEndpoint = undefined;
    next.observed.usbOutEndpoint = undefined;
    next.observed.inputPackets = undefined;
    next.observed.inputErrors = undefined;
  }
  if (next.completedAt && status.defaultPassword === true) next.completedAt = undefined;
  return next;
}

export function observeMidi(state: CommissioningState, event: MidiInputEvent): CommissioningState {
  if (event.state !== "on" || event.note !== 60) return state;
  const next = structuredClone(state);
  next.observed.c4Seen = true;
  return next;
}

export function missingCommissioningEvidence(state: CommissioningState): string[] {
  const missing: string[] = [];
  const manualLabels: Record<keyof CommissioningState["manual"], string> = {
    wiringInspected: "断电万用表接线检查",
    fuseInstalled: "5 V 支路保险丝",
    stripPowerSeparate: "灯带电流绕过 ESP32 且全部支路受 3 A 总保险保护",
    mountNonDamaging: "无损安装材料确认",
    lightA0: "A0 灯位确认",
    lightC4: "C4 灯位确认",
    lightC8: "C8 灯位确认",
    mountStable: "强奏无触键/位移确认",
  };
  for (const [key, label] of Object.entries(manualLabels) as [keyof CommissioningState["manual"], string][]) {
    if (!state.manual[key]) missing.push(label);
  }
  if (!state.observed.deviceSeen) missing.push("ESP WebSocket 实际连接");
  if (!state.observed.passwordChanged) missing.push("修改公开的默认热点密码");
  if (!state.observed.pianoSeen) missing.push("PX-S7000 USB 实际枚举");
  if (!state.observed.usbInEndpoint) missing.push("USB MIDI IN 端点");
  if (!state.observed.c4Seen) missing.push("钢琴实际弹下中央 C");
  if ((state.observed.inputErrors ?? 0) > 0) missing.push("USB 输入错误必须归零");
  return missing;
}

export function completeCommissioning(state: CommissioningState, now = Date.now()): CommissioningState {
  if (missingCommissioningEvidence(state).length > 0) throw new Error("验收证据尚未齐全");
  const next = structuredClone(state);
  next.completedAt = now;
  next.completedFirmware = next.observed.firmware;
  return next;
}

export function commissioningReport(state: CommissioningState): CommissioningReport {
  const missing = missingCommissioningEvidence(state);
  return {
    product: "NoteFall 88",
    version: 1,
    exportedAt: new Date().toISOString(),
    complete: missing.length === 0 && state.completedAt !== undefined,
    missing,
    state: structuredClone(state),
  };
}
