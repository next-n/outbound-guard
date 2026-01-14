// test/integration.test.ts
import { describe, expect, it } from "vitest";
import http from "node:http";
import { ResilientHttpClient } from "../src/client.js";
import { RequestTimeoutError } from "../src/errors.js";

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, url: `http://127.0.0.1:${addr.port}` });
      }
    });
  });
}

describe("integration", () => {
  it("performs a basic GET successfully", async () => {
    const { server, url } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("ok");
    });

    const client = new ResilientHttpClient({
      maxInFlight: 10,
      maxQueue: 100,
      enqueueTimeoutMs: 500,
      requestTimeoutMs: 500,
      breaker: {
        windowSize: 50,
        minRequests: 20,
        failureThreshold: 0.5,
        cooldownMs: 5000,
        halfOpenProbeCount: 3,
      },
    });

    try {
      const resp = await client.request({ method: "GET", url: `${url}/hello` });
      expect(resp.status).toBe(200);
      expect(new TextDecoder().decode(resp.body)).toBe("ok");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("times out slow upstream requests", async () => {
    const { server, url } = await startServer((_req, res) => {
      // intentionally never responding quickly
      setTimeout(() => {
        res.statusCode = 200;
        res.end("late");
      }, 200);
    });

    const client = new ResilientHttpClient({
      maxInFlight: 10,
      maxQueue: 100,
      enqueueTimeoutMs: 500,
      requestTimeoutMs: 50,
      breaker: {
        windowSize: 50,
        minRequests: 20,
        failureThreshold: 0.5,
        cooldownMs: 5000,
        halfOpenProbeCount: 3,
      },
    });

    try {
      await expect(
        client.request({ method: "GET", url: `${url}/slow` })
      ).rejects.toBeInstanceOf(RequestTimeoutError);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
