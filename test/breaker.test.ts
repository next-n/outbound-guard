// test/breaker.test.ts
import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/breaker.js";

describe("CircuitBreaker", () => {
  it("opens when failure rate exceeds threshold after minRequests", () => {
    const br = new CircuitBreaker({
      windowSize: 10,
      minRequests: 4,
      failureThreshold: 0.5,
      cooldownMs: 1000,
      halfOpenProbeCount: 2,
    });

    const key = "svc";

    // Push failures/successes until the threshold is met, then force a failure if needed.
    br.allow(key);
    br.onFailure(key);

    br.allow(key);
    br.onSuccess(key);

    br.allow(key);
    br.onFailure(key);

    br.allow(key);
    br.onSuccess(key);

    if (br.state(key) !== "OPEN") {
      br.allow(key);
      br.onFailure(key);
    }

    expect(br.state(key)).toBe("OPEN");
  });

  it("fails fast while OPEN until cooldown, then HALF_OPEN", () => {
    const br = new CircuitBreaker({
      windowSize: 5,
      minRequests: 1,
      failureThreshold: 1,
      cooldownMs: 100,
      halfOpenProbeCount: 2,
    });

    const key = "svc";
    const t0 = 1000;

    br.allow(key, t0);
    br.onFailure(key, t0);
    expect(br.state(key)).toBe("OPEN");

    const d1 = br.allow(key, t0 + 50);
    expect(d1.allowed).toBe(false);
    expect(d1.state).toBe("OPEN");

    const d2 = br.allow(key, t0 + 120);
    expect(d2.allowed).toBe(true);
    expect(br.state(key)).toBe("HALF_OPEN");
  });

  it("half-open allows limited probes and closes after enough successes", () => {
    const br = new CircuitBreaker({
      windowSize: 5,
      minRequests: 1,
      failureThreshold: 1,
      cooldownMs: 50,
      halfOpenProbeCount: 2,
    });

    const key = "svc";
    const t0 = 1000;

    // Trip OPEN
    br.allow(key, t0);
    br.onFailure(key, t0);
    expect(br.state(key)).toBe("OPEN");

    // This call both transitions to HALF_OPEN and consumes probe #1
    const probe1 = br.allow(key, t0 + 60);
    expect(br.state(key)).toBe("HALF_OPEN");
    expect(probe1.allowed).toBe(true);

    // Probe #2 allowed
    const probe2 = br.allow(key, t0 + 61);
    expect(probe2.allowed).toBe(true);

    // Probe #3 blocked (max probes reached)
    const blocked = br.allow(key, t0 + 62);
    expect(blocked.allowed).toBe(false);

    // Mark probes successful -> should close after enough successes
    br.onSuccess(key);
    expect(br.state(key)).toBe("HALF_OPEN");

    const change = br.onSuccess(key);
    expect(change.changed).toBe(true);
    expect(br.state(key)).toBe("CLOSED");
  });

  it("half-open reopens on any failure", () => {
    const br = new CircuitBreaker({
      windowSize: 5,
      minRequests: 1,
      failureThreshold: 1,
      cooldownMs: 50,
      halfOpenProbeCount: 2,
    });

    const key = "svc";
    const t0 = 1000;

    br.allow(key, t0);
    br.onFailure(key, t0);
    expect(br.state(key)).toBe("OPEN");

    // Transition+probe
    br.allow(key, t0 + 60);
    expect(br.state(key)).toBe("HALF_OPEN");

    // Any failure in HALF_OPEN reopens immediately
    br.allow(key, t0 + 61);
    const change = br.onFailure(key, t0 + 61);
    expect(change.changed).toBe(true);
    expect(br.state(key)).toBe("OPEN");
  });
});
