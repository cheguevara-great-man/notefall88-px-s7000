export type Hand = "left" | "right";
export type HandSelection = "both" | Hand;
export type PracticeMode = "realtime" | "wait" | "follow";

export interface ScoreNote {
  note: number;
  start: number;
  end: number;
  velocity: number;
  hand: Hand;
}

export interface ParsedScore {
  name: string;
  duration: number;
  notes: ScoreNote[];
  format?: "midi" | "musicxml";
  measureStarts?: number[];
}

export interface TargetNote {
  note: number;
  hand: Hand;
}

export interface DeviceStatus {
  protocol?: number;
  firmware?: string;
  piano: boolean;
  clients: number;
  brightness: number;
  offset: number;
  reversed: boolean;
  rssi?: number;
  uptimeMs?: number;
  freeHeap?: number;
  psramBytes?: number;
  freePsram?: number;
  usbPackets?: number;
  usbDropped?: number;
  usbErrors?: number;
  usbConnections?: number;
  usbLastPacketMs?: number;
  usbVid?: number;
  usbPid?: number;
  usbEndpoint?: number;
  usbPacketSize?: number;
  usbOut?: boolean;
  usbOutEndpoint?: number;
  usbOutPacketSize?: number;
  usbOutPackets?: number;
  usbOutDropped?: number;
  usbOutErrors?: number;
  usbOutQueued?: number;
  usbEchoSuppressed?: number;
  usbOutOwned?: boolean;
}

export interface MidiOutEvent {
  delayMs: number;
  status: number;
  data1: number;
  data2: number;
}

export interface MidiOutResult {
  ok: boolean;
  busy: boolean;
  accepted: number;
  queued: number;
}

export interface MidiInputEvent {
  state: "on" | "off";
  channel: number;
  note: number;
  velocity: number;
  timestamp: number;
}

export interface MidiControlEvent {
  channel: number;
  controller: number;
  value: number;
  timestamp: number;
}

export interface CalibrationState {
  offsets: number[];
}

export interface PracticeStats {
  hits: number;
  wrong: number;
  missed: number;
  accuracy: number;
}
