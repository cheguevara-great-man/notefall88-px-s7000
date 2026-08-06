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

export interface BeatMarker {
  time: number;
  accent: boolean;
  beat: number;
  measure: number;
}

export interface ParsedScore {
  name: string;
  duration: number;
  notes: ScoreNote[];
  format?: "midi" | "musicxml";
  measureStarts?: number[];
  measureMap?: number[];
  beatMap?: BeatMarker[];
}

export interface TargetNote {
  note: number;
  hand: Hand;
}

export interface DeviceStatus {
  protocol?: number;
  firmware?: string;
  controlSessionReady?: boolean;
  controlAuthorized?: boolean;
  accessPointClient?: boolean;
  defaultPassword?: boolean;
  controlToken?: string;
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
  nvsReady?: boolean;
  resetReason?: string;
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
  usbOutputMirrorCandidates?: number;
  usbOutOwned?: boolean;
  webRejected?: number;
  webAuthRejected?: number;
  webMidiDropped?: number;
  ledInputLatencyLastUs?: number;
  ledInputLatencyAvgUs?: number;
  ledInputLatencyMaxUs?: number;
  ledInputLatencySamples?: number;
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
  highResolutionVelocity?: number;
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
