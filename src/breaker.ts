// src/breaker.ts
import type { BreakerOptions, BreakerState } from "./types.js";
import { RollingWindow } from "./utils/rollingWindow.js";

interface BreakerBucket {
  state: BreakerState;
  openedAtMs?: number;
  halfOpenInFlight: number;

  window: RollingWindow;

  // HALF_OPEN bookkeeping
  halfOpenSuccesses: number;
  halfOpenFailures: number;
}

export interface BreakerDecision {
  allowed: boolean;
  state: BreakerState;
  retryAfterMs?: number; // only when OPEN and blocked
}

/**
 * Process-local circuit breaker.
 * - CLOSED: allow, track failures in rolling window; may OPEN if threshold exceeded.
 * - OPEN: block until cooldown passes, then HALF_OPEN.
 * - HALF_OPEN: allow limited probes; close on enough successes, open on any failure.
 */
export class CircuitBreaker {
  private readonly opts: BreakerOptions;
  private readonly buckets = new Map<string, BreakerBucket>();

  constructor(opts: BreakerOptions) {
    if (!Number.isFinite(opts.windowSize) || opts.windowSize <= 0) throw new Error("windowSize must be > 0");
    if (!Number.isFinite(opts.minRequests) || opts.minRequests < 0) throw new Error("minRequests must be >= 0");
    if (opts.failureThreshold < 0 || opts.failureThreshold > 1) throw new Error("failureThreshold must be 0..1");
    if (!Number.isFinite(opts.cooldownMs) || opts.cooldownMs <= 0) throw new Error("cooldownMs must be > 0");
    if (!Number.isFinite(opts.halfOpenProbeCount) || opts.halfOpenProbeCount <= 0)
      throw new Error("halfOpenProbeCount must be > 0");
    this.opts = opts;
  }

  private bucket(key: string): BreakerBucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        state: "CLOSED",
        halfOpenInFlight: 0,
        window: new RollingWindow(this.opts.windowSize),
        halfOpenSuccesses: 0,
        halfOpenFailures: 0,
      };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Decide whether an outbound call is allowed for this key.
   * If allowed, caller MUST later call `onSuccess` or `onFailure`.
   */
  allow(key: string, nowMs: number = Date.now()): BreakerDecision {
    const b = this.bucket(key);

    if (b.state === "OPEN") {
      const elapsed = nowMs - (b.openedAtMs ?? nowMs);
      const remaining = this.opts.cooldownMs - elapsed;

      if (remaining > 0) {
        return { allowed: false, state: "OPEN", retryAfterMs: remaining };
      }

      // cooldown passed -> transition to HALF_OPEN
      this.toHalfOpen(b);
    }

    if (b.state === "HALF_OPEN") {
      if (b.halfOpenInFlight >= this.opts.halfOpenProbeCount) {
        // Block extra probes while half-open
        return { allowed: false, state: "HALF_OPEN", retryAfterMs: 0 };
      }
      b.halfOpenInFlight += 1;
      return { allowed: true, state: "HALF_OPEN" };
    }

    // CLOSED
    return { allowed: true, state: "CLOSED" };
  }

  onSuccess(key: string): { changed: boolean; from?: BreakerState; to?: BreakerState } {
    const b = this.bucket(key);

    if (b.state === "HALF_OPEN") {
      b.halfOpenInFlight = Math.max(0, b.halfOpenInFlight - 1);
      b.halfOpenSuccesses += 1;

      if (b.halfOpenSuccesses >= this.opts.halfOpenProbeCount) {
        const from: BreakerState = "HALF_OPEN";
        this.toClosed(b);
        return { changed: true, from, to: "CLOSED" };
      }
      return { changed: false };
    }

    // CLOSED -> record success as 0 failure
    if (b.state === "CLOSED") b.window.push(0);
    return { changed: false };
  }

  onFailure(key: string, nowMs: number = Date.now()): { changed: boolean; from?: BreakerState; to?: BreakerState } {
    const b = this.bucket(key);

    if (b.state === "HALF_OPEN") {
      b.halfOpenInFlight = Math.max(0, b.halfOpenInFlight - 1);
      b.halfOpenFailures += 1;

      const from: BreakerState = "HALF_OPEN";
      this.toOpen(b, nowMs);
      return { changed: true, from, to: "OPEN" };
    }

    if (b.state === "CLOSED") {
      b.window.push(1);

      const n = b.window.count();
      if (n >= this.opts.minRequests && b.window.failureRate() >= this.opts.failureThreshold) {
        const from: BreakerState = "CLOSED";
        this.toOpen(b, nowMs);
        return { changed: true, from, to: "OPEN" };
      }
    }

    return { changed: false };
  }

  state(key: string): BreakerState {
    return this.bucket(key).state;
  }

  snapshot(): Array<{ key: string; state: BreakerState; windowCount: number; windowFailures: number; openedAtMs?: number }> {
    const out: Array<{ key: string; state: BreakerState; windowCount: number; windowFailures: number; openedAtMs?: number }> = [];
    for (const [key, b] of this.buckets.entries()) {
      out.push({
        key,
        state: b.state,
        windowCount: b.window.count(),
        windowFailures: b.window.failures(),
        openedAtMs: b.openedAtMs,
      });
    }
    return out;
  }

  private toOpen(b: BreakerBucket, nowMs: number): void {
    b.state = "OPEN";
    b.openedAtMs = nowMs;

    // Keep rolling window intact (realistic), but reset HALF_OPEN stats
    b.halfOpenInFlight = 0;
    b.halfOpenSuccesses = 0;
    b.halfOpenFailures = 0;
  }

  private toHalfOpen(b: BreakerBucket): void {
    b.state = "HALF_OPEN";
    b.openedAtMs = undefined;

    b.halfOpenInFlight = 0;
    b.halfOpenSuccesses = 0;
    b.halfOpenFailures = 0;
  }

  private toClosed(b: BreakerBucket): void {
    b.state = "CLOSED";
    b.openedAtMs = undefined;

    // Reset stats on close to avoid immediate re-open from old history.
    b.window.reset();

    b.halfOpenInFlight = 0;
    b.halfOpenSuccesses = 0;
    b.halfOpenFailures = 0;
  }
}
