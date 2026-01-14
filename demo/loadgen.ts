// demo/loadgen.ts
import { ResilientHttpClient } from "../src/client.js";
import {
  CircuitOpenError,
  QueueFullError,
  QueueTimeoutError,
  RequestTimeoutError,
} from "../src/errors.js";

const UPSTREAM = process.env.UPSTREAM ?? "http://127.0.0.1:3001";
const TOTAL = Number(process.env.TOTAL ?? 500);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);

const client = new ResilientHttpClient({
  maxInFlight: Number(process.env.MAX_IN_FLIGHT ?? 10),
  maxQueue: Number(process.env.MAX_QUEUE ?? 50),
  enqueueTimeoutMs: Number(process.env.ENQUEUE_TIMEOUT_MS ?? 150),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120),
  breaker: {
    windowSize: Number(process.env.BREAKER_WINDOW ?? 30),
    minRequests: Number(process.env.BREAKER_MIN_REQ ?? 10),
    failureThreshold: Number(process.env.BREAKER_THRESHOLD ?? 0.5),
    cooldownMs: Number(process.env.BREAKER_COOLDOWN_MS ?? 800),
    halfOpenProbeCount: Number(process.env.BREAKER_PROBES ?? 3),
  },
});

type Counters = Record<string, number>;
const c: Counters = {
  ok: 0,
  http5xx: 0,
  timeout: 0,
  queueFull: 0,
  queueTimeout: 0,
  circuitOpen: 0,
  otherErr: 0,
};

client.on("breaker:state", (e: any) => {
  // eslint-disable-next-line no-console
  console.log(`[breaker] key=${e.key} ${e.from} -> ${e.to}`);
});

function classifyErr(err: unknown): keyof Counters {
  if (err instanceof CircuitOpenError) return "circuitOpen";
  if (err instanceof QueueFullError) return "queueFull";
  if (err instanceof QueueTimeoutError) return "queueTimeout";
  if (err instanceof RequestTimeoutError) return "timeout";
  return "otherErr";
}

async function worker(id: number, jobs: number[]) {
  for (const _ of jobs) {
    try {
      const resp = await client.request({ method: "GET", url: `${UPSTREAM}/flaky` });
      if (resp.status >= 500) c.http5xx++;
      else c.ok++;
    } catch (err) {
      const k = classifyErr(err);
      c[k]++;
    }

    if ((c.ok + c.http5xx + c.timeout + c.queueFull + c.queueTimeout + c.circuitOpen + c.otherErr) % 50 === 0) {
      const snap = client.snapshot();
      // eslint-disable-next-line no-console
      console.log(`[snap] inFlight=${snap.inFlight} queue=${snap.queueDepth} ok=${c.ok} 5xx=${c.http5xx} to=${c.timeout} qf=${c.queueFull} qt=${c.queueTimeout} co=${c.circuitOpen}`);
    }
  }
}

function chunkIndices(total: number, workers: number): number[][] {
  const chunks: number[][] = Array.from({ length: workers }, () => []);
  for (let i = 0; i < total; i++) chunks[i % workers].push(i);
  return chunks;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`[loadgen] upstream=${UPSTREAM} total=${TOTAL} concurrency=${CONCURRENCY}`);

  const chunks = chunkIndices(TOTAL, CONCURRENCY);
  await Promise.all(chunks.map((jobs, i) => worker(i, jobs)));

  // eslint-disable-next-line no-console
  console.log(`[done]`, c);

  const snap = client.snapshot();
  // eslint-disable-next-line no-console
  console.log(`[final snapshot]`, snap);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
