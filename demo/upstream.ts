// demo/upstream.ts
import http from "node:http";

const PORT = Number(process.env.UPSTREAM_PORT ?? 3001);

// Behavior knobs
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.35); // 35% 500s
const SLOW_RATE = Number(process.env.SLOW_RATE ?? 0.25); // 25% slow responses
const SLOW_MS = Number(process.env.SLOW_MS ?? 300);      // slow delay

function rand(): number {
  return Math.random();
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    return res.end("bad request");
  }

  if (req.url.startsWith("/health")) {
    res.statusCode = 200;
    return res.end("ok");
  }

  const r = rand();

  // Fail
  if (r < FAIL_RATE) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ ok: false, kind: "fail", ts: Date.now() }));
  }

  // Slow
  if (r < FAIL_RATE + SLOW_RATE) {
    setTimeout(() => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, kind: "slow", ts: Date.now() }));
    }, SLOW_MS);
    return;
  }

  // Normal
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, kind: "fast", ts: Date.now() }));
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(
    `[upstream] listening on http://127.0.0.1:${PORT} (FAIL_RATE=${FAIL_RATE}, SLOW_RATE=${SLOW_RATE}, SLOW_MS=${SLOW_MS})`
  );
});
