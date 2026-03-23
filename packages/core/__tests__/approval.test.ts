import { describe, expect, it, vi } from "vitest";
import { InMemoryApprovalStore, requiresApprovalRule } from "../src/hitl/approval.js";
import type { AgentContext } from "../src/types/index.js";

const ctx: AgentContext = { agentId: "agent_1", sessionId: "session_1" };

// ─── InMemoryApprovalStore ────────────────────────────────────────────────────

describe("InMemoryApprovalStore", () => {
  it("creates a pending request", () => {
    const store = new InMemoryApprovalStore();
    const req = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: { name: "delete_file" } },
      description: 'Agent wants to call "delete_file"',
    });

    expect(req.id).toMatch(/^approval_/);
    expect(req.status).toBe("pending");
    expect(req.createdAt).toBeInstanceOf(Date);
  });

  it("gets a request by id", () => {
    const store = new InMemoryApprovalStore();
    const req = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "test",
    });
    expect(store.get(req.id)?.id).toBe(req.id);
  });

  it("returns null for unknown id", () => {
    const store = new InMemoryApprovalStore();
    expect(store.get("nonexistent")).toBeNull();
  });

  it("resolves to approved", () => {
    const store = new InMemoryApprovalStore();
    const req = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "test",
    });
    const resolved = store.resolve(req.id, { approved: true });
    expect(resolved.status).toBe("approved");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it("resolves to rejected with reason", () => {
    const store = new InMemoryApprovalStore();
    const req = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "test",
    });
    const resolved = store.resolve(req.id, { approved: false, reason: "Too risky" });
    expect(resolved.status).toBe("rejected");
    expect(resolved.rejectionReason).toBe("Too risky");
  });

  it("throws when resolving an already-resolved request", () => {
    const store = new InMemoryApprovalStore();
    const req = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "test",
    });
    store.resolve(req.id, { approved: true });
    expect(() => store.resolve(req.id, { approved: false })).toThrow();
  });

  it("getPending returns only pending requests for session", () => {
    const store = new InMemoryApprovalStore();
    const r1 = store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "t1",
    });
    store.create({
      sessionId: "s2",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "t2",
    });
    store.resolve(r1.id, { approved: true });

    const pending = store.getPending("s1");
    expect(pending).toHaveLength(0);

    const pendingS2 = store.getPending("s2");
    expect(pendingS2).toHaveLength(1);
  });

  it("clear removes all requests for session", () => {
    const store = new InMemoryApprovalStore();
    store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "t1",
    });
    store.create({
      sessionId: "s1",
      agentId: "a1",
      action: { type: "tool_call", payload: {} },
      description: "t2",
    });
    store.clear("s1");
    expect(store.getPending("s1")).toHaveLength(0);
  });
});

// ─── requiresApprovalRule ─────────────────────────────────────────────────────

describe("requiresApprovalRule", () => {
  it("allows non-tool actions", async () => {
    const store = new InMemoryApprovalStore();
    const rule = requiresApprovalRule({ tools: ["delete_file"], store });
    const result = await rule.check({ type: "message", payload: "hello" }, ctx);
    expect(result.allowed).toBe(true);
  });

  it("allows tool calls not in the list", async () => {
    const store = new InMemoryApprovalStore();
    const rule = requiresApprovalRule({ tools: ["delete_file"], store });
    const result = await rule.check({ type: "tool_call", payload: { name: "read_file" } }, ctx);
    expect(result.allowed).toBe(true);
  });

  it("calls onRequest when approval is needed", async () => {
    const store = new InMemoryApprovalStore();
    const onRequest = vi.fn();

    // Auto-approve immediately for the test
    const originalCreate = store.create.bind(store);
    store.create = (input) => {
      const req = originalCreate(input);
      setTimeout(() => store.resolve(req.id, { approved: true }), 10);
      return req;
    };

    const rule = requiresApprovalRule({ tools: ["delete_file"], store, onRequest });
    await rule.check({ type: "tool_call", payload: { name: "delete_file" } }, ctx);

    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest.mock.calls[0][0].description).toContain("delete_file");
  });

  it("blocks action when rejected", async () => {
    const store = new InMemoryApprovalStore();

    const originalCreate = store.create.bind(store);
    store.create = (input) => {
      const req = originalCreate(input);
      setTimeout(() => store.resolve(req.id, { approved: false, reason: "Not allowed" }), 10);
      return req;
    };

    const rule = requiresApprovalRule({ tools: ["delete_file"], store });
    const result = await rule.check({ type: "tool_call", payload: { name: "delete_file" } }, ctx);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("rejected");
  });
});
