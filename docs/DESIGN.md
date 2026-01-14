# DESIGN

## What this library is
A small, process-local outbound HTTP client that enforces:
- concurrency limits (in-flight cap)
- bounded queue (backpressure)
- timeouts
- per-upstream circuit breaker

## What it is not
- Not durable (no persistence)
- Not distributed (no Redis/Kafka)
- Not a service mesh
- Not retry-heavy by default

## Why in-process?
Backpressure and breakers are first-class *local* protections:
- stop your own process from melting down
- fail fast when upstream is unhealthy
- keep latencies bounded under load

Durability belongs to DB/queues/outbox layers above this library.
