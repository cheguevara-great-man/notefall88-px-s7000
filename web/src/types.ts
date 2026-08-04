export type Hand = "left" | "right";
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
  piano: boolean;
  clients: number;
  brightness: number;
  offset: number;
  reversed: boolean;
  rssi?: number;
  uptimeMs?: number;
}

export interface MidiInputEvent {
  state: "on" | "off";
  note: number;
  velocity: number;
  timestamp: number;
}
