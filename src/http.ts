// src/http.ts
import { request as undiciRequest } from "undici";
import { RequestTimeoutError } from "./errors.js";
import type { ResilientRequest, ResilientResponse } from "./types.js";

function normalizeHeaders(headers: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;

  // undici headers are an object-like structure (headers: Record<string, string | string[]>)
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) out[k.toLowerCase()] = v.join(", ");
    else if (typeof v === "string") out[k.toLowerCase()] = v;
    else out[k.toLowerCase()] = String(v);
  }
  return out;
}

/**
 * Execute a single HTTP request with a hard timeout using AbortController.
 * No retries. No breaker. Just raw outbound I/O with a timeout.
 */
export async function doHttpRequest(
  req: ResilientRequest,
  requestTimeoutMs: number
): Promise<ResilientResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), requestTimeoutMs);

  try {
    const res = await undiciRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body as any,
      signal: ac.signal,
    });

    const body = await res.body.arrayBuffer();
    return {
      status: res.statusCode,
      headers: normalizeHeaders(res.headers),
      body: new Uint8Array(body),
    };
  } catch (err: any) {
    // undici throws AbortError on abort
    if (err?.name === "AbortError") {
      throw new RequestTimeoutError(requestTimeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
