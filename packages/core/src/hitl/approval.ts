import type { AgentAction, AgentContext } from "../types/index.js";
import { generateId } from "../utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected" | "timeout";

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  agentId: string;
  action: AgentAction;
  /** Human-readable description of what the agent wants to do */
  description: string;
  status: ApprovalStatus;
  createdAt: Date;
  resolvedAt?: Date;
  /** Optional reason provided when rejecting */
  rejectionReason?: string;
  /** Timeout in ms — auto-rejects after this duration */
  timeoutMs?: number;
}

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

// ─── ApprovalStore ────────────────────────────────────────────────────────────

/**
 * Storage interface for pending approval requests.
 * In-process by default — swap for Redis in production for multi-instance deploys.
 */
export interface ApprovalStore {
  create(request: Omit<ApprovalRequest, "id" | "createdAt" | "status">): ApprovalRequest;
  get(id: string): ApprovalRequest | null;
  resolve(id: string, result: ApprovalResult): ApprovalRequest;
  getPending(sessionId: string): ApprovalRequest[];
  clear(sessionId: string): void;
}

// ─── InMemoryApprovalStore ────────────────────────────────────────────────────

export class InMemoryApprovalStore implements ApprovalStore {
  private requests = new Map<string, ApprovalRequest>();

  create(input: Omit<ApprovalRequest, "id" | "createdAt" | "status">): ApprovalRequest {
    const request: ApprovalRequest = {
      ...input,
      id: generateId("approval"),
      status: "pending",
      createdAt: new Date(),
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string): ApprovalRequest | null {
    return this.requests.get(id) ?? null;
  }

  resolve(id: string, result: ApprovalResult): ApprovalRequest {
    const request = this.requests.get(id);
    if (!request) throw new Error(`Approval request not found: ${id}`);
    if (request.status !== "pending") throw new Error(`Approval ${id} already resolved`);

    const resolved: ApprovalRequest = {
      ...request,
      status: result.approved ? "approved" : "rejected",
      resolvedAt: new Date(),
      ...(result.reason !== undefined && { rejectionReason: result.reason }),
    };
    this.requests.set(id, resolved);
    return resolved;
  }

  getPending(sessionId: string): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter(
      (r) => r.sessionId === sessionId && r.status === "pending",
    );
  }

  clear(sessionId: string): void {
    for (const [id, req] of this.requests.entries()) {
      if (req.sessionId === sessionId) this.requests.delete(id);
    }
  }
}

// ─── requiresApproval rule ───────────────────────────────────────────────────

import type { Rule, RuleResult } from "../types/index.js";

/**
 * A Rule that intercepts specific tool calls and requires human approval.
 *
 * When triggered, it creates an ApprovalRequest and waits for resolution
 * before allowing or blocking the action.
 *
 * @example
 * ```ts
 * const agent = new VercelAIAgent({
 *   ...
 *   rules: [
 *     requiresApprovalRule({
 *       tools: ["delete_file", "send_email", "deploy"],
 *       store: approvalStore,
 *       onRequest: (req) => {
 *         // notify UI via SSE, webhook, etc.
 *         console.log("Approval needed:", req.description)
 *       },
 *       timeoutMs: 60_000,
 *     }),
 *   ],
 * })
 * ```
 */
export interface RequiresApprovalConfig {
  /** Tool names that require approval */
  tools: string[];
  /** Store to persist approval requests */
  store: ApprovalStore;
  /**
   * Called when a new approval request is created.
   * Use to notify the UI via SSE or webhook.
   */
  onRequest?: (request: ApprovalRequest) => void;
  /**
   * How long to wait for approval before auto-rejecting.
   * @default 120_000 (2 minutes)
   */
  timeoutMs?: number;
}

export function requiresApprovalRule(config: RequiresApprovalConfig): Rule {
  const { tools, store, onRequest, timeoutMs = 120_000 } = config;

  return {
    name: "requires-approval",
    description: `Requires human approval for: ${tools.join(", ")}`,

    async check(action: AgentAction, context: AgentContext): Promise<RuleResult> {
      if (action.type !== "tool_call") return { allowed: true };

      const toolName = (action.payload as { name?: string }).name;
      if (!toolName || !tools.includes(toolName)) return { allowed: true };

      // Create approval request
      const request = store.create({
        sessionId: context.sessionId,
        agentId: context.agentId,
        action,
        description: `Agent wants to call "${toolName}" with args: ${JSON.stringify(
          (action.payload as { arguments?: unknown }).arguments ?? {},
        )}`,
        timeoutMs,
      });

      onRequest?.(request);

      // Poll for resolution
      const approved = await waitForApproval(request.id, store, timeoutMs);

      if (!approved) {
        return {
          allowed: false,
          reason: `Action "${toolName}" was rejected or timed out`,
        };
      }

      return { allowed: true };
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForApproval(
  id: string,
  store: ApprovalStore,
  timeoutMs: number,
): Promise<boolean> {
  const interval = 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const request = store.get(id);
    if (!request) return false;
    if (request.status === "approved") return true;
    if (request.status === "rejected" || request.status === "timeout") return false;
    await new Promise((r) => setTimeout(r, interval));
  }

  // Timeout — auto-reject
  try {
    store.resolve(id, { approved: false, reason: "Timeout" });
  } catch {
    // already resolved
  }
  return false;
}
