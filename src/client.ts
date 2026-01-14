// src/client.ts
import { EventEmitter } from "node:events";
import { ConcurrencyLimiter } from "./limiter.js";
import { doHttpRequest } from "./http.js";
import { CircuitBreaker } from "./breaker.js";
import { CircuitOpenError } from "./errors.js";
import type { ResilientHttpClientOptions, ResilientRequest, ResilientResponse } from "./types.js";

function defaultKeyFn(req: ResilientRequest): string {
  return new URL(req.url).host;
}

function genRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ResilientHttpClient extends EventEmitter {
  private readonly limiter: ConcurrencyLimiter;
  private readonly breaker: CircuitBreaker;
  private readonly requestTimeoutMs: number;
  private readonly keyFn: (req: ResilientRequest) => string;

  constructor(private readonly opts: ResilientHttpClientOptions) {
    super();

    this.limiter = new ConcurrencyLimiter({
      maxInFlight: opts.maxInFlight,
      maxQueue: opts.maxQueue,
      enqueueTimeoutMs: opts.enqueueTimeoutMs,
    });

    this.breaker = new CircuitBreaker(opts.breaker);
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.keyFn = opts.keyFn ?? defaultKeyFn;
  }

  async request(req: ResilientRequest): Promise<ResilientResponse> {
    const key = this.keyFn(req);
    const requestId = genRequestId();

    // Circuit decision before consuming concurrency/queue:
    const decision = this.breaker.allow(key);
    if (!decision.allowed) {
      const err = new CircuitOpenError(key, decision.retryAfterMs ?? 0);
      this.emit("request:rejected", { key, requestId, request: req, error: err });
      return Promise.reject(err);
    }

    // Acquire (may reject with QueueFullError / QueueTimeoutError)
    try {
      await this.limiter.acquire();
    } catch (err) {
      this.emit("request:rejected", { key, requestId, request: req, error: err });
      // If we were HALF_OPEN and never executed I/O, treat as failure? No.
      // Queue rejection is local load-shedding; don't punish upstream breaker.
      throw err;
    }

    const start = Date.now();
    this.emit("request:start", { key, requestId, request: req });

    try {
      const res = await doHttpRequest(req, this.requestTimeoutMs);

      // classify success/failure for breaker based on status code
      if (res.status >= 500) {
        const change = this.breaker.onFailure(key);
        if (change.changed) this.emit("breaker:state", { key, from: change.from, to: change.to });
      } else {
        const change = this.breaker.onSuccess(key);
        if (change.changed) this.emit("breaker:state", { key, from: change.from, to: change.to });
      }

      const durationMs = Date.now() - start;
      this.emit("request:success", { key, requestId, request: req, status: res.status, durationMs });
      return res;
    } catch (err) {
      const change = this.breaker.onFailure(key);
      if (change.changed) this.emit("breaker:state", { key, from: change.from, to: change.to });

      const durationMs = Date.now() - start;
      this.emit("request:failure", { key, requestId, request: req, error: err, durationMs });
      throw err;
    } finally {
      this.limiter.release();
    }
  }

  snapshot(): { inFlight: number; queueDepth: number; breakers: ReturnType<CircuitBreaker["snapshot"]> } {
    const s = this.limiter.snapshot();
    return { inFlight: s.inFlight, queueDepth: s.queueDepth, breakers: this.breaker.snapshot() };
  }
}
