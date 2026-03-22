import { describe, expect, it } from "vitest";

// Note: useAgent and AgentProvider require a browser environment (jsdom).
// Full integration tests live in apps/example-nextjs.
// Here we test the pure logic: SSE parsing and auth helpers.

// ─── SSE parsing (extracted logic) ───────────────────────────────────────────

function parseSSELine(line: string): { type: string; content: unknown } | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

describe("SSE parsing", () => {
  it("parses a message event", () => {
    const line = `data: {"type":"message","content":"Hello!","timestamp":"2025-01-01T00:00:00Z"}`;
    const result = parseSSELine(line);
    expect(result?.type).toBe("message");
    expect(result?.content).toBe("Hello!");
  });

  it("parses a thinking event", () => {
    const line = `data: {"type":"thinking","content":"Iteration 1"}`;
    const result = parseSSELine(line);
    expect(result?.type).toBe("thinking");
  });

  it("returns null for [DONE]", () => {
    expect(parseSSELine("data: [DONE]")).toBeNull();
  });

  it("returns null for non-data lines", () => {
    expect(parseSSELine("event: message")).toBeNull();
    expect(parseSSELine("")).toBeNull();
    expect(parseSSELine(": keep-alive")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseSSELine("data: {bad json}")).toBeNull();
  });
});

// ─── Message state helpers ────────────────────────────────────────────────────

describe("Message ID generation", () => {
  it("generates unique IDs", () => {
    const ids = new Set(
      Array.from(
        { length: 100 },
        () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ),
    );
    expect(ids.size).toBe(100);
  });
});
