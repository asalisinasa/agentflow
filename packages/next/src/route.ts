import type { Agent, AgentRunOptions } from "@agentsdk/core";
import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import type { AuthHandler } from "./auth.js";
import { noAuth } from "./auth.js";
import { createSSEStream } from "./sse.js";

/**
 * Config for createAgentRoute.
 */
export interface AgentRouteConfig {
  /**
   * The agent to run on incoming requests.
   */
  agent: Agent;

  /**
   * Auth handler to verify the request before running the agent.
   * Defaults to noAuth() — allow all requests.
   *
   * @example
   * ```ts
   * import { bearerTokenAuth } from "@agentsdk/next"
   * auth: bearerTokenAuth()
   * ```
   * @example with NextAuth:
   * ```ts
   * auth: async (req) => {
   *   const session = await getServerSession()
   *   if (!session?.user?.id) return { authenticated: false }
   *   return { authenticated: true, userId: session.user.id }
   * }
   * ```
   */
  auth?: AuthHandler;

  /**
   * Whether to stream the response as SSE.
   * @default true
   */
  streaming?: boolean;

  /**
   * Max request body size in bytes.
   * @default 1MB
   */
  maxBodySize?: number;

  /**
   * Optional hook — called before the agent runs.
   * Use to log, validate, or modify the goal.
   */
  onRequest?: (goal: string, req: NextRequest) => Promise<string | void> | string | void;

  /**
   * Optional hook — called after the agent finishes.
   * Use to log or persist results.
   */
  onComplete?: (output: string, req: NextRequest) => Promise<void> | void;
}

export interface AgentRouteHandlers {
  POST: (req: NextRequest) => Promise<Response>;
}

/**
 * Creates a Next.js App Router POST handler that runs an agent on a request.
 *
 * Supports SSE streaming, auth, and lifecycle hooks.
 *
 * @example
 * ```ts
 * // app/api/agent/route.ts
 * import { createAgentRoute } from "@agentsdk/next"
 * import { myAgent } from "@/agents/my-agent"
 *
 * export const { POST } = createAgentRoute({ agent: myAgent })
 * ```
 *
 * @example with auth and streaming:
 * ```ts
 * export const { POST } = createAgentRoute({
 *   agent: myAgent,
 *   auth: async (req) => {
 *     const session = await getServerSession()
 *     if (!session?.user) return { authenticated: false }
 *     return { authenticated: true, userId: session.user.id }
 *   },
 *   streaming: true,
 * })
 * ```
 */
export function createAgentRoute(config: AgentRouteConfig): AgentRouteHandlers {
  const {
    agent,
    auth = noAuth(),
    streaming = true,
    maxBodySize = 1024 * 1024,
    onRequest,
    onComplete,
  } = config;

  return {
    async POST(req: NextRequest): Promise<Response> {
      // ─── Auth check ───────────────────────────────────────────────────────
      const authResult = await auth(req);
      if (!authResult.authenticated) {
        return NextResponse.json({ error: authResult.reason ?? "Unauthorized" }, { status: 401 });
      }

      // ─── Parse body ───────────────────────────────────────────────────────
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxBodySize) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }

      let body: { goal?: string; sessionId?: string };
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }

      if (!body.goal || typeof body.goal !== "string") {
        return NextResponse.json({ error: "Missing required field: goal" }, { status: 400 });
      }

      // ─── onRequest hook ───────────────────────────────────────────────────
      let goal = body.goal;
      if (onRequest) {
        const modified = await onRequest(goal, req);
        if (typeof modified === "string") goal = modified;
      }

      // ─── Run options ──────────────────────────────────────────────────────
      const runOptions: AgentRunOptions = {
        userId: authResult.userId,
        ...(body.sessionId !== undefined && { sessionId: body.sessionId }),
      };

      // ─── SSE streaming ────────────────────────────────────────────────────
      if (streaming && agent.stream) {
        const stream = createSSEStream(async (emit, signal) => {
          runOptions.signal = signal;
          runOptions.onStep = emit;

          const result = await agent.run(goal, runOptions);

          if (onComplete) {
            await onComplete(result.output, req);
          }
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      }

      // ─── Non-streaming JSON response ──────────────────────────────────────
      try {
        const result = await agent.run(goal, runOptions);

        if (onComplete) {
          await onComplete(result.output, req);
        }

        return NextResponse.json({
          output: result.output,
          steps: result.steps.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent run failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },
  };
}
