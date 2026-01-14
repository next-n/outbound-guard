// test/limiter.test.ts
import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter } from "../src/limiter.js";
import { QueueFullError, QueueTimeoutError } from "../src/errors.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ConcurrencyLimiter", () => {
  it("allows up to maxInFlight without queueing", async () => {
    const lim = new ConcurrencyLimiter({ maxInFlight: 2, maxQueue: 10, enqueueTimeoutMs: 50 });

    await lim.acquire();
    await lim.acquire();

    const snap = lim.snapshot();
    expect(snap.inFlight).toBe(2);
    expect(snap.queueDepth).toBe(0);

    lim.release();
    lim.release();
    expect(lim.snapshot().inFlight).toBe(0);
  });

  it("queues when maxInFlight reached, and dequeues on release", async () => {
    const lim = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10, enqueueTimeoutMs: 200 });

    await lim.acquire(); // occupy only slot

    let acquiredSecond = false;
    const p2 = lim.acquire().then(() => {
      acquiredSecond = true;
    });

    await sleep(20);
    expect(acquiredSecond).toBe(false);
    expect(lim.snapshot().queueDepth).toBe(1);

    lim.release(); // should transfer permit to queued request
    await p2;

    expect(acquiredSecond).toBe(true);
    expect(lim.snapshot().inFlight).toBe(1); // still held by second
    expect(lim.snapshot().queueDepth).toBe(0);

    lim.release(); // release second
    expect(lim.snapshot().inFlight).toBe(0);
  });

  it("rejects immediately when queue is full", async () => {
    const lim = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 1, enqueueTimeoutMs: 200 });

    await lim.acquire(); // occupy in-flight

    const pQueued = lim.acquire(); // goes into queue (size 1)
    await sleep(10);
    expect(lim.snapshot().queueDepth).toBe(1);

    await expect(lim.acquire()).rejects.toBeInstanceOf(QueueFullError);

    // cleanup
    lim.release(); // transfers to pQueued
    await pQueued;
    lim.release();
  });

  it("rejects with QueueTimeoutError if waiting too long", async () => {
    const lim = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10, enqueueTimeoutMs: 50 });

    await lim.acquire(); // occupy in-flight

    await expect(lim.acquire()).rejects.toBeInstanceOf(QueueTimeoutError);

    // cleanup
    lim.release();
  });

  it("throws if release called too many times", async () => {
    const lim = new ConcurrencyLimiter({ maxInFlight: 1, maxQueue: 10, enqueueTimeoutMs: 50 });

    await lim.acquire();
    lim.release();

    expect(() => lim.release()).toThrow(/inFlight is already 0/);
  });
});
