# resilient-http — Spec (Phase 0)

## Goal
Provide an outbound HTTP client for Node.js that prevents cascading failures by enforcing:
- concurrency limits (in-flight cap)
- bounded queue (backpressure)
- timeouts (queue + request)
- circuit breaker (per-upstream key)
- observability hooks (events + snapshot)

This is a library-first repo: teachable, testable, reusable.

## Non-goals
- No persistence (no durable queue, no resume-after-restart)
- No distributed coordination (no Redis/Kafka required)
- No service discovery
- No metrics backend (only hooks/events)
- No automatic retries by default (optional later, explicit)

## Definitions
- **In-flight**: requests currently executing the outbound HTTP call.
- **Queue**: pending requests waiting for an in-flight slot.
- **Backpressure**: rejecting requests when queue is full or wait time exceeded.
- **Breaker key**: identifier used to scope circuit breaker state (default: host).

## Core behaviors

### Concurrency + Queue
- At most `maxInFlight` requests may be in-flight.
- Additional requests enqueue up to `maxQueue`.
- If queue is full: reject immediately with `QueueFullError`.
- If a request waits longer than `enqueueTimeoutMs`: reject with `QueueTimeoutError`.
- Rejected requests MUST NOT execute outbound I/O.

### Request timeout
- Each outbound request has a hard timeout `requestTimeoutMs`.
- On timeout: abort the request and surface `RequestTimeoutError`.

### Circuit breaker
Breaker is scoped by `keyFn(req)`.
States:
- CLOSED: normal operation
- OPEN: fail-fast (no outbound call) for `cooldownMs`
- HALF_OPEN: allow `halfOpenProbeCount` probe requests; success closes, failure reopens

Open conditions:
- Track results in a rolling window of size `windowSize`.
- If `minRequests` satisfied AND failureRate >= `failureThreshold`, transition CLOSED -> OPEN.

During OPEN:
- All requests fail fast with `CircuitOpenError` (no outbound call).

### Ordering
- No global ordering guarantee across queued requests.
- FIFO queue is default.

### Observability
Library emits events for key lifecycle changes and exposes a `snapshot()`.

## API surface (high-level)
- `new ResilientHttpClient(options)`
- `client.request(req): Promise<Response>`
- `client.snapshot(): Snapshot`
- `client.on(eventName, handler)`
