import type { ApprovalStore } from "@agentsdk/core";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";

/**
 * Creates Next.js route handlers for approving and rejecting agent actions.
 *
 * Mount at `/api/agent/approval/route.ts`.
 *
 * @example
 * ```ts
 * // app/api/agent/approval/route.ts
 * import { createApprovalRoute } from "@agentsdk/next"
 * import { approvalStore } from "@/lib/approval-store"
 *
 * export const { POST } = createApprovalRoute({ store: approvalStore })
 * ```
 *
 * Client calls:
 * ```ts
 * // Approve
 * POST /api/agent/approval  { id: "approval_xxx", approved: true }
 *
 * // Reject
 * POST /api/agent/approval  { id: "approval_xxx", approved: false, reason: "Too risky" }
 * ```
 */
export function createApprovalRoute(config: { store: ApprovalStore }) {
  return {
    async POST(req: NextRequest): Promise<Response> {
      let body: { id?: string; approved?: boolean; reason?: string };
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      if (!body.id || typeof body.id !== "string") {
        return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
      }

      if (typeof body.approved !== "boolean") {
        return NextResponse.json(
          { error: "Missing required field: approved (boolean)" },
          { status: 400 },
        );
      }

      const request = config.store.get(body.id);
      if (!request) {
        return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
      }

      if (request.status !== "pending") {
        return NextResponse.json(
          { error: `Approval already resolved: ${request.status}` },
          { status: 409 },
        );
      }

      try {
        const resolved = config.store.resolve(body.id, {
          approved: body.approved,
          reason: body.reason,
        });
        return NextResponse.json({ id: resolved.id, status: resolved.status });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resolve approval";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },

    async GET(req: NextRequest): Promise<Response> {
      const sessionId = req.nextUrl.searchParams.get("sessionId");
      if (!sessionId) {
        return NextResponse.json({ error: "Missing query param: sessionId" }, { status: 400 });
      }

      const pending = config.store.getPending(sessionId);
      return NextResponse.json({ requests: pending });
    },
  };
}

/**
 * Encodes an approval request as an SSE event.
 * Call this inside createAgentRoute's onRequest/onStep callbacks
 * to push approval requests to the UI in real time.
 */
export function encodeApprovalEvent(request: {
  id: string;
  description: string;
  action: unknown;
}): string {
  return `data: ${JSON.stringify({ type: "approval_required", content: request })}\n\n`;
}
