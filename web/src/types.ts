export type Hand = "left" | "right";
export type HandSelection = "both" | Hand;
export type PracticeMode = "realtime" | "wait";

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
  usbPackets?: number;
  usbDropped?: number;
  usbErrors?: number;
  usbConnections?: number;
  usbLastPacketMs?: number;
  usbVid?: number;
  usbPid?: number;
  usbEndpoint?: number;
  usbPacketSize?: number;
}

export interface MidiInputEvent {
  state: "on" | "off";
  note: number;
  velocity: number;
  timestamp: number;
}

export interface PracticeStats {
  hits: number;
  wrong: number;
  missed: number;
  accuracy: number;
}
