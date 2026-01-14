import type { BreakerState } from "./types";

export interface BreakerSnapshot {
  key: string;
  state: BreakerState;
  openedAtMs?: number;
  halfOpenInFlight?: number;
  windowCount: number;
  windowFailures: number;
}

export interface ClientSnapshot {
  inFlight: number;
  queueDepth: number;
  breakers: BreakerSnapshot[];
}
