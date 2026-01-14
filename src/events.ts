import type { BreakerState, ResilientRequest } from "./types";

export type ResilientHttpEventName =
  | "queue:enqueued"
  | "queue:dequeued"
  | "queue:full"
  | "queue:timeout"
  | "breaker:state"
  | "request:start"
  | "request:success"
  | "request:failure"
  | "request:rejected";

export interface BreakerStateEvent {
  key: string;
  from: BreakerState;
  to: BreakerState;
}

export interface RequestEventBase {
  key: string;
  request: ResilientRequest;
  requestId: string; // generated UUID-like string (no external deps)
}

export interface RequestResultEvent extends RequestEventBase {
  durationMs: number;
  status?: number;     // set on success or upstream response
  errorName?: string;  // set on failure
}

export interface QueueEvent extends RequestEventBase {
  queueDepth: number;
}
