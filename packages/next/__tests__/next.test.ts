import { describe, expect, it, vi, beforeEach } from "vitest";
import { bearerTokenAuth, noAuth } from "../src/auth.js";
import { encodeSSEEvent, encodeSSEDone, encodeSSEError } from "../src/sse.js";
import type { AgentStep } from "@agentsdk/core";

// ─── Mock NextRequest ─────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): { headers: { get: (k: string) => string | null } } {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  };
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

describe("bearerTokenAuth", () => {
  it("allows request with valid Bearer token", () => {
    const auth = bearerTokenAuth();
    const result = auth(makeRequest({ authorization: "Bearer my-token-123" }) as any);
    expect(result).toEqual({ authenticated: true, userId: "my-token-123" });
  });

  it("rejects request with no Authorization header", () => {
    const auth = bearerTokenAuth();
    const result = auth(makeRequest() as any);
    expect(result).toMatchObject({ authenticated: false });
  });

  it("rejects request with non-Bearer scheme", () => {
    const auth = bearerTokenAuth();
    const result = auth(makeRequest({ authorization: "Basic dXNlcjpwYXNz" }) as any);
    expect(result).toMatchObject({ authenticated: false });
  });

  it("rejects empty Bearer token", () => {
    const auth = bearerTokenAuth();
    const result = auth(makeRequest({ authorization: "Bearer " }) as any);
    expect(result).toMatchObject({ authenticated: false });
  });
});

describe("noAuth", () => {
  it("always returns authenticated", () => {
    const auth = noAuth();
    const result = auth(makeRequest() as any);
    expect(result).toEqual({ authenticated: true, userId: "anonymous" });
  });

  it("uses custom userId when provided", () => {
    const auth = noAuth("test-user");
    const result = auth(makeRequest() as any);
    expect(result).toEqual({ authenticated: true, userId: "test-user" });
  });
});

// ─── SSE encoding ─────────────────────────────────────────────────────────────

describe("SSE encoding", () => {
  it("encodeSSEEvent formats a step as SSE", () => {
    const step: AgentStep = {
      type: "message",
      content: "hello world",
      timestamp: new Date("2025-01-01T00:00:00Z"),
    };
    const encoded = encodeSSEEvent(step);
    expect(encoded).toContain("data:");
    expect(encoded).toContain('"type":"message"');
    expect(encoded).toContain('"content":"hello world"');
    expect(encoded.endsWith("\n\n")).toBe(true);
  });

  it("encodeSSEDone returns [DONE] signal", () => {
    expect(encodeSSEDone()).toContain("[DONE]");
    expect(encodeSSEDone().endsWith("\n\n")).toBe(true);
  });

  it("encodeSSEError formats error as SSE", () => {
    const encoded = encodeSSEError("something went wrong");
    expect(encoded).toContain('"type":"error"');
    expect(encoded).toContain('"content":"something went wrong"');
    expect(encoded.endsWith("\n\n")).toBe(true);
  });
});
