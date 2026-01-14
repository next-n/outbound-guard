// src/limiter.ts
import { QueueFullError, QueueTimeoutError } from "./errors.js";

type ResolveFn = () => void;
type RejectFn = (err: unknown) => void;

interface Waiter {
  resolve: ResolveFn;
  reject: RejectFn;
  timer: NodeJS.Timeout;
}

/**
 * A simple in-process concurrency limiter with a bounded FIFO queue.
 *
 * - At most maxInFlight "permits" can be held concurrently.
 * - If no permit is available, callers are queued up to maxQueue.
 * - If queue is full => reject immediately (QueueFullError).
 * - If a caller waits too long in the queue => reject (QueueTimeoutError).
 *
 * This is intentionally process-local: no persistence, no external coordination.
 */
export class ConcurrencyLimiter {
  private readonly maxInFlight: number;
  private readonly maxQueue: number;
  private readonly enqueueTimeoutMs: number;

  private inFlight = 0;
  private queue: Waiter[] = [];

  constructor(opts: { maxInFlight: number; maxQueue: number; enqueueTimeoutMs: number }) {
    if (!Number.isFinite(opts.maxInFlight) || opts.maxInFlight <= 0) {
      throw new Error(`maxInFlight must be > 0 (got ${opts.maxInFlight})`);
    }
    if (!Number.isFinite(opts.maxQueue) || opts.maxQueue < 0) {
      throw new Error(`maxQueue must be >= 0 (got ${opts.maxQueue})`);
    }
    if (!Number.isFinite(opts.enqueueTimeoutMs) || opts.enqueueTimeoutMs <= 0) {
      throw new Error(`enqueueTimeoutMs must be > 0 (got ${opts.enqueueTimeoutMs})`);
    }

    this.maxInFlight = opts.maxInFlight;
    this.maxQueue = opts.maxQueue;
    this.enqueueTimeoutMs = opts.enqueueTimeoutMs;
  }

  /**
   * Acquire a permit. Resolves once you are allowed to proceed.
   * MUST be followed by `release()` exactly once.
   */
  acquire(): Promise<void> {
    // Fast path: permit available
    if (this.inFlight < this.maxInFlight) {
      this.inFlight += 1;
      return Promise.resolve();
    }

    // Queue disabled or full
    if (this.maxQueue === 0 || this.queue.length >= this.maxQueue) {
      return Promise.reject(new QueueFullError(this.maxQueue));
    }

    // Enqueue and wait
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // On timeout, remove from queue if still present
        const idx = this.queue.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) {
          const [w] = this.queue.splice(idx, 1);
          clearTimeout(w.timer);
        }
        reject(new QueueTimeoutError(this.enqueueTimeoutMs));
      }, this.enqueueTimeoutMs);

      this.queue.push({ resolve, reject, timer });
    });
  }

  /**
   * Release a permit. Always call this in a `finally` block.
   */
  release(): void {
    if (this.inFlight <= 0) {
      // Defensive: indicates a bug in caller usage.
      throw new Error("release() called when inFlight is already 0");
    }

    // If someone is waiting, hand off permit directly without reducing inFlight.
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      // Permit is transferred to the next waiter; inFlight stays the same.
      next.resolve();
      return;
    }

    // No waiters => reduce inFlight
    this.inFlight -= 1;
  }

  snapshot(): { inFlight: number; queueDepth: number; maxInFlight: number; maxQueue: number } {
    return {
      inFlight: this.inFlight,
      queueDepth: this.queue.length,
      maxInFlight: this.maxInFlight,
      maxQueue: this.maxQueue,
    };
  }
}
