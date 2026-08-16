export type Hand = "left" | "right";
export type HandSelection = "both" | Hand;
export type PracticeMode = "realtime" | "wait" | "follow";
export type TimingProfile = "adaptive" | "relaxed" | "strict";

export interface TimingWindow {
  earlyMs: number;
  lateMs: number;
}

export interface ScoreNote {
  note: number;
  start: number;
  end: number;
  velocity: number;
  hand: Hand;
  /** Expected sounding gate relative to the written duration (MusicXML articulation). */
  articulationGate?: number;
  /** Expanded playback position in quarter notes; available for MusicXML. */
  scoreQuarterStart?: number;
  scoreQuarterEnd?: number;
}

export interface BeatMarker {
  time: number;
  accent: boolean;
  beat: number;
  measure: number;
}

export type ScorePedalAction = "down" | "up" | "change-up" | "change-down" | "level";

export interface ScorePedalEvent {
  time: number;
  value: number;
  action: ScorePedalAction;
  scoreQuarter?: number;
}

export interface ParsedScore {
  name: string;
  duration: number;
  notes: ScoreNote[];
  format?: "midi" | "musicxml";
  measureStarts?: number[];
  /** Expanded playback measure boundaries in quarter notes, including the final end. */
  measureQuarterStarts?: number[];
  measureMap?: number[];
  beatMap?: BeatMarker[];
  /** Expanded damper-pedal targets parsed from MusicXML directions/sound. */
  pedalEvents?: ScorePedalEvent[];
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
  stationConnected?: boolean;
  stationIp?: string;
  hostname?: string;
  rescueSsid?: string;
  otaPending?: boolean;
  uptimeMs?: number;
  freeHeap?: number;
  psramBytes?: number;
  freePsram?: number;
  nvsReady?: boolean;
  resetReason?: string;
  usbPackets?: number;
  usbDropped?: number;
  usbMalformed?: number;
  usbErrors?: number;
  usbLastError?: string;
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
  usbInputQueueDepth?: number;
  usbInputQueueHighWater?: number;
  usbOutputQueueDepth?: number;
  usbOutputQueueHighWater?: number;
  usbLargestInputBatch?: number;
  usbInputResubmitRetries?: number;
  usbClientWatchdog?: boolean;
  usbDaemonWatchdog?: boolean;
  usbOutputMirrorCandidates?: number;
  usbOutOwned?: boolean;
  webRejected?: number;
  webAuthRejected?: number;
  webMidiDropped?: number;
  webMidiResyncs?: number;
  webMidiQueueDepth?: number;
  webMidiQueueHighWater?: number;
  midiDispatchLatencyLastUs?: number;
  midiDispatchLatencyAvgUs?: number;
  midiDispatchLatencyMaxUs?: number;
  midiDispatchLatencySamples?: number;
  ledInputLatencyLastUs?: number;
  ledInputLatencyAvgUs?: number;
  ledInputLatencyMaxUs?: number;
  ledInputLatencySamples?: number;
  ledFrames?: number;
  ledFramesSkipped?: number;
  ledSpiLastUs?: number;
  ledSpiMaxUs?: number;
  ledFrameBytes?: number;
  realtimeReady?: boolean;
  realtimeWatchdog?: boolean;
  realtimeHeartbeatAgeMs?: number;
  realtimeWakeups?: number;
  realtimeStackFreeBytes?: number;
  mainLoopLastUs?: number;
  mainLoopMaxUs?: number;
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
  /** ESP capture time projected onto the browser's performance.now() clock. */
  capturedAt?: number;
  /** Estimated ESP queue + WebSocket delivery delay; diagnostic only. */
  transportDelayMs?: number;
  /** Half of the best clock-sync ping round trip; bounds projection error. */
  clockSyncErrorMs?: number;
}

export interface MidiControlEvent {
  channel: number;
  controller: number;
  value: number;
  timestamp: number;
  capturedAt?: number;
  transportDelayMs?: number;
  clockSyncErrorMs?: number;
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
